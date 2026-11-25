import {startAttempt,endAttempt} from './attempt-store.mjs';
import {randomUUID,createHash} from 'node:crypto';
export function claim(state, role, worker, now, ttl=60000, maxAttempts=3) {
  if (!role || !worker || !Number.isSafeInteger(now) || !Number.isSafeInteger(ttl) || ttl<1 || !Number.isSafeInteger(now+ttl) || !Number.isSafeInteger(maxAttempts) || maxAttempts<1) throw Error('invalid claim');
  for(const t of state.tasks){
    if(t.state==='running' && t.expiresAt<=now){
      endAttempt(state,t.token,now,'expired',{reason:'lease-expired'});
      t.failure='lease-expired';
      t.state=t.attempts>=(t.attemptLimit??(Object.hasOwn(state.specs??{},t.id)?state.specs[t.id].limits.maxAttempts:maxAttempts))?'blocked':'queued';
      delete t.token;delete t.worker;delete t.expiresAt;
    }
  }
  const task=state.tasks.find(t=>t.role===role && t.state==='queued' && t.attempts<(t.attemptLimit??(Object.hasOwn(state.specs??{},t.id)?state.specs[t.id].limits.maxAttempts:maxAttempts)) && (t.deps??[]).every(id=>state.tasks.some(d=>d.id===id&&d.state==='accepted')));
  if(!task)return null;
  Object.assign(task,{state:'running',attemptLimit:task.attemptLimit??(Object.hasOwn(state.specs??{},task.id)?state.specs[task.id].limits.maxAttempts:maxAttempts),worker,attemptId:randomUUID(),token:randomUUID(),expiresAt:now+ttl,attempts:task.attempts+1});
  startAttempt(state,task,'execution',worker,task.token,now);
  return structuredClone(task);
}
export function submit(state,id,token,artifact,now){
  const t=state.tasks.find(t=>t.id===id);
  if(!t || t.state!=='running'||!token||t.token!==token||!Number.isSafeInteger(now)||t.expiresAt<=now||typeof artifact!=='string'||!artifact.trim())throw Error('invalid or expired lease');
  endAttempt(state,token,now,'submitted',{artifactSha256:createHash('sha256').update(artifact).digest('hex')});
  t.state='review';t.artifact=artifact;delete t.token;delete t.expiresAt;
}
export function review(state,id,reviewer,passed,evidence,maxAttempts=3){
  const t=state.tasks.find(t=>t.id===id);
  if(!t||t.state!=='review'||!reviewer||reviewer===t.worker||typeof passed!=='boolean'||typeof evidence!=='string'||!evidence.trim()||!Number.isSafeInteger(maxAttempts)||maxAttempts<1)throw Error('independent evidence required');
  t.reviewer=reviewer;t.evidence=evidence;
  t.state=passed?'accepted':t.attempts>=(t.attemptLimit??maxAttempts)?'blocked':'queued';
}

export function failExecution(state,id,token,now){
 const t=state.tasks.find(t=>t.id===id);
 if(!t||t.state!=='running'||!token||t.token!==token||!Number.isSafeInteger(now)||t.expiresAt<=now)return false;
 t.state=t.attempts>=t.attemptLimit?'blocked':'queued';
 endAttempt(state,token,now,'failed',{reason:'execution-error'});
 t.failure='execution-error';delete t.token;delete t.worker;delete t.expiresAt;return true;
}
