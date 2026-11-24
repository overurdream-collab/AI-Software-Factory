// Trusted operator intake; issue content is data, never authority.
export function enqueue(state, definitions){
 if(!Array.isArray(definitions)||definitions.length>1000)throw Error('invalid batch');
 const existing=new Map(state.tasks.map(t=>[t.id,t]));
 const incoming=new Map();
 for(const d of definitions){
  if(!d||typeof d.id!=='string'||! /^[a-zA-Z0-9_-]{1,100}$/.test(d.id)||typeof d.role!=='string'||!d.role.trim()||typeof d.goal!=='string'||!d.goal.trim()||d.goal.length>16000||!Array.isArray(d.deps??[])||(d.deps??[]).some(x=>typeof x!=='string')||incoming.has(d.id))throw Error('invalid task');
  const t={id:d.id,role:d.role,goal:d.goal,deps:[...new Set(d.deps??[])].sort(),state:'queued',attempts:0};
  const old=existing.get(t.id);
  if(old&&(old.role!==t.role||old.goal!==t.goal||JSON.stringify([...(old.deps??[])].sort())!==JSON.stringify(t.deps)))throw Error('conflicting task');
  incoming.set(t.id,old??t);
 }
 const all=new Map([...existing,...incoming]);
 const active=new Set(),done=new Set();
 function visit(id){
  if(done.has(id))return;
  if(active.has(id)||!all.has(id))throw Error('missing dependency or cycle');
  active.add(id);for(const dep of all.get(id).deps??[])visit(dep);active.delete(id);done.add(id);
 }
 for(const id of all.keys())visit(id);
 const added=[...incoming.values()].filter(t=>!existing.has(t.id));
 state.tasks.push(...added);
 return added.length;
}
