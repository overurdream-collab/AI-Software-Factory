import {randomUUID} from 'node:crypto';
import {enqueue} from './intake.mjs';
const own=(o,k)=>Object.hasOwn(o??{},k);
const validTime=n=>Number.isSafeInteger(n)&&n>=0;
const oid=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
export function enqueueSpec(state,spec){
 const s=spec, l=s?.limits;
 if(s?.version!==1||s.role!=='dev'||typeof s.repository!=='string'||!/^[-\w.]+\/[-\w.]+$/.test(s.repository)||!oid(s.baseCommit)||!Array.isArray(s.deps)||!Array.isArray(s.allowedPaths)||!s.allowedPaths.length||s.allowedPaths.some(p=>typeof p!=='string'||!p||p.includes('\\')||p.includes(':')||p.split('/').some(x=>!x||x==='.'||x==='..'||x.toLowerCase()==='.git'))||typeof s.testPlanId!=='string'||!s.testPlanId||!l||['maxAttempts','maxReviewAttempts','deadlineMs','maxPatchBytes'].some(k=>!Number.isSafeInteger(l[k])||l[k]<1))throw Error('invalid spec');
 const normalized={version:1,id:s.id,role:s.role,goal:s.goal,deps:[...new Set(s.deps)].sort(),repository:s.repository,baseCommit:s.baseCommit,allowedPaths:[...new Set(s.allowedPaths)].sort(),testPlanId:s.testPlanId,limits:{maxAttempts:l.maxAttempts,maxReviewAttempts:l.maxReviewAttempts,deadlineMs:l.deadlineMs,maxPatchBytes:l.maxPatchBytes}};
 state.specs??={};
 if(own(state.specs,s.id)&&JSON.stringify(state.specs[s.id])!==JSON.stringify(normalized))throw Error('conflicting spec');
 const n=enqueue(state,[normalized]);
 Object.defineProperty(state.specs,s.id,{value:normalized,enumerable:true,configurable:true,writable:true});
 return n;
}
export function recordResource(state,r){
 if(!r||r.kind!=='docker'||!r.id||!r.name||!r.owner||!r.leaseToken||!r.attemptId||!validTime(r.createdAt))throw Error('invalid resource');
 const t=state.tasks.find(t=>t.id===r.taskId&&t.attemptId===r.attemptId);
 if(!live(t,r,r.createdAt))throw Error('stale resource lease');
 state.resources??=[];
 if(state.resources.some(x=>x.id===r.id||x.name===r.name))throw Error('duplicate resource');
 state.resources.push({id:r.id,taskId:r.taskId,attemptId:r.attemptId,leaseToken:r.leaseToken,owner:r.owner,kind:r.kind,name:r.name,createdAt:r.createdAt});
}
function live(t,r,now){return !!t&&((t.state==='running'&&t.token===r.leaseToken&&t.worker===r.owner&&t.expiresAt>now)||(t.state==='review'&&t.reviewToken===r.leaseToken&&t.reviewOwner===r.owner&&t.reviewExpiresAt>now));}
export function listReclaimableResources(state,now){
 if(!validTime(now))throw Error('invalid time');
 return structuredClone((state.resources??[]).filter(r=>r.cleanedAt===undefined&&!live(state.tasks.find(t=>t.id===r.taskId&&t.attemptId===r.attemptId),r,now)));
}
export function markResourceCleaned(state,id,now){
 const r=(state.resources??[]).find(r=>r.id===id);
 if(!r||!validTime(now)||now<r.createdAt||live(state.tasks.find(t=>t.id===r.taskId&&t.attemptId===r.attemptId),r,now))throw Error('invalid cleanup');
 r.cleanedAt??=now;
}
export function getDelivery(state,key){return structuredClone((state.deliveries??[]).find(d=>d.key===key)??null);}
export function reserveDelivery(state,key,owner,now,ttlMs){
 if(typeof key!=='string'||!key||!owner||!validTime(now)||!Number.isSafeInteger(ttlMs)||ttlMs<1||!validTime(now+ttlMs))throw Error('invalid delivery reservation');
 state.deliveries??=[];
 let d=state.deliveries.find(d=>d.key===key);
 if(!d){d={key,state:'pending',repository:key.split(':')[0]};state.deliveries.push(d);}
 if(d.state==='delivered'||d.state==='blocked'||(d.state==='delivering'&&d.expiresAt>now))return null;
 Object.assign(d,{state:'delivering',owner,token:randomUUID(),expiresAt:now+ttlMs});
 return {key,owner,token:d.token,expiresAt:d.expiresAt};
}
export function finishDelivery(state,key,token,now,result){
 const d=(state.deliveries??[]).find(d=>d.key===key);
 if(!d||d.state!=='delivering'||!token||d.token!==token||!validTime(now)||d.expiresAt<=now)throw Error('stale delivery');
 if(!result||!['pending','blocked','delivered'].includes(result.state))throw Error('invalid delivery result');
 if(result.state==='delivered'&&(!oid(result.commitSha)||result.checkedCommit!==result.commitSha||!Number.isSafeInteger(result.prNumber)||result.prNumber<1||!result.prUrl||!Array.isArray(result.checkRunIds)||!result.checkRunIds.length))throw Error('missing delivery evidence');
 for(const k of ['state','repository','branch','commitSha','prNumber','prUrl','checkedCommit','checkRunIds','failure'])if(own(result,k))d[k]=structuredClone(result[k]);
 delete d.owner;delete d.token;delete d.expiresAt;
}
export function startAttempt(state,t,phase,owner,token,now){
 state.attempts??=[];
 state.attempts.push({id:phase==='execution'?t.attemptId:randomUUID(),taskId:t.id,attemptId:t.attemptId,phase,owner,token,startedAt:now,state:'running'});
}
export function endAttempt(state,token,now,status,details={}){
 const a=(state.attempts??[]).find(a=>a.token===token&&a.state==='running');
 if(a)Object.assign(a,details,{state:status,finishedAt:now});
}
