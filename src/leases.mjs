import {randomUUID} from 'node:crypto';
export function claim(state, role, worker, now, ttl=60000, maxAttempts=3) {
  if (!role || !worker || !Number.isSafeInteger(now) || !Number.isSafeInteger(ttl) || ttl<1 || !Number.isSafeInteger(maxAttempts) || maxAttempts<1) throw Error('invalid claim');
  for(const t of state.tasks){
    if(t.state==='running' && t.expiresAt<=now){
      t.state=t.attempts>=maxAttempts?'blocked':'queued';
      delete t.token;delete t.worker;delete t.expiresAt;
    }
  }
  const task=state.tasks.find(t=>t.role===role && t.state==='queued' && t.attempts<maxAttempts && (t.deps??[]).every(id=>state.tasks.some(d=>d.id===id&&d.state==='accepted')));
  if(!task)return null;
  Object.assign(task,{state:'running',worker,token:randomUUID(),expiresAt:now+ttl,attempts:task.attempts+1});
  return structuredClone(task);
}
export function submit(state,id,token,artifact,now){
  const t=state.tasks.find(t=>t.id===id);
  if(!t || t.state!=='running'||!token||t.token!==token||!Number.isSafeInteger(now)||t.expiresAt<=now||typeof artifact!=='string'||!artifact.trim())throw Error('invalid or expired lease');
  t.state='review';t.artifact=artifact;delete t.token;delete t.expiresAt;
}
export function review(state,id,reviewer,passed,evidence,maxAttempts=3){
  const t=state.tasks.find(t=>t.id===id);
  if(!t||t.state!=='review'||!reviewer||reviewer===t.worker||typeof passed!=='boolean'||typeof evidence!=='string'||!evidence.trim()||!Number.isSafeInteger(maxAttempts)||maxAttempts<1)throw Error('independent evidence required');
  t.reviewer=reviewer;t.evidence=evidence;
  t.state=passed?'accepted':t.attempts>=maxAttempts?'blocked':'queued';
}
