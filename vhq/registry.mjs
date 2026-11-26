import {DatabaseSync} from 'node:sqlite';
import {prepareAssignment} from './executive.mjs';
import {authorize} from './policy.mjs';
import {createHash} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const validId=x=>typeof x==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(x);
export function openRegistry(path) {
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL;');
  db.exec(`CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, repository TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS assignments(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), fingerprint TEXT NOT NULL, priority INTEGER NOT NULL, payload TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS dependencies(task_id TEXT NOT NULL REFERENCES assignments(id), dependency_id TEXT NOT NULL REFERENCES assignments(id), PRIMARY KEY(task_id,dependency_id));
  CREATE TABLE IF NOT EXISTS pilot_runs(task_id TEXT PRIMARY KEY REFERENCES assignments(id), state TEXT NOT NULL, started INTEGER NOT NULL, finished INTEGER, evidence TEXT);
  CREATE TABLE IF NOT EXISTS audit(seq INTEGER PRIMARY KEY, task_id TEXT NOT NULL REFERENCES assignments(id), event TEXT NOT NULL, at INTEGER NOT NULL);
  `);
  function tx(fn){db.exec('BEGIN IMMEDIATE');try{const out=fn();db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}
  function submit({projectId,request,grant,routes,now,priority=0,deps=[]}) {
    if(!validId(projectId)||!Number.isSafeInteger(priority)||priority<0||priority>100||
      !Array.isArray(deps)||deps.length>100||!deps.every(validId)) throw Error('invalid registry input');
    const a=prepareAssignment({request,grant,routes,now});
    if(a.state==='denied') return a;
    const dependencies=[...new Set(deps)].sort();
    if(dependencies.includes(a.id)) throw Error('self dependency');
    const fingerprint=digest([projectId,a.repository,a.goal,a.kind,a.complexity,a.sensitivity,priority,dependencies]);
    return tx(()=>{
      const existing=db.prepare('SELECT * FROM assignments WHERE id=?').get(a.id);
      if(existing){if(existing.fingerprint!==fingerprint)throw Error('assignment conflict');return JSON.parse(existing.payload);}
      db.prepare('INSERT OR IGNORE INTO projects VALUES (?,?)').run(projectId,a.repository);
      if(db.prepare('SELECT repository FROM projects WHERE id=?').get(projectId).repository!==a.repository) throw Error('project repository conflict');
      for(const dep of dependencies){
        const row=db.prepare('SELECT project_id FROM assignments WHERE id=?').get(dep);
        if(!row||row.project_id!==projectId)throw Error('invalid dependency');
      }
      const payload={...a,projectId,priority,deps:dependencies};
      db.prepare('INSERT INTO assignments VALUES (?,?,?,?,?)').run(a.id,projectId,fingerprint,priority,JSON.stringify(payload));
      for(const dep of dependencies)db.prepare('INSERT INTO dependencies VALUES (?,?)').run(a.id,dep);
      db.prepare('INSERT INTO audit(task_id,event,at) VALUES (?,?,?)').run(a.id,'intake',now);
      return payload;
    });
  }
  function list({grant,repository,now}){
    if(!authorize(grant,{action:'read',repository,paid:false,production:false},now))throw Error('read denied');
    return db.prepare('SELECT a.payload FROM assignments a JOIN projects p ON p.id=a.project_id WHERE p.repository=? ORDER BY a.priority DESC,a.id').all(repository).map(x=>JSON.parse(x.payload));
  }
  function claimPilot({id,grant,repository,now}){
    if(!authorize(grant,{action:'submit',repository,paid:false,production:false},now))throw Error('denied');
    return tx(()=>{const row=db.prepare('SELECT payload FROM assignments WHERE id=?').get(id);
      const a=row&&JSON.parse(row.payload);
      if(!a||a.repository!==repository||a.projectId!=='pilot'||a.kind!=='coding'||a.state!=='queued'||a.deps.length)throw Error('pilot only');
      const prior=db.prepare('SELECT state FROM pilot_runs WHERE task_id=?').get(id);
      if(prior)return false;
      db.prepare('INSERT INTO pilot_runs(task_id,state,started) VALUES (?,?,?)').run(id,'running',now);
      db.prepare('INSERT INTO audit(task_id,event,at) VALUES (?,?,?)').run(id,'pilot-start',now);return true;});
  }
  function finishPilot(id,state,evidence,now){
    if(!['pilot-verified','blocked-reconcile'].includes(state))throw Error('invalid state');
    return tx(()=>{const result=db.prepare("UPDATE pilot_runs SET state=?,finished=?,evidence=? WHERE task_id=? AND state='running'").run(state,now,JSON.stringify(evidence),id);
    if(result.changes!==1)throw Error('not running');
    db.prepare('INSERT INTO audit(task_id,event,at) VALUES (?,?,?)').run(id,state,now);});
  }
  function pilotStatus(id){const row=db.prepare('SELECT state,started,finished,evidence FROM pilot_runs WHERE task_id=?').get(id);return row?{...row,evidence:row.evidence?JSON.parse(row.evidence):null}:null;}
  return {submit,list,claimPilot,finishPilot,pilotStatus,close:()=>db.close()};
}
// Registry stores intake decisions only. It never treats ready as running, releases dependencies,
// or dispatches workers. Those operations require the factory adapter and fresh authorization.
