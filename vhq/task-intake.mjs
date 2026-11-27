import {isDeepStrictEqual} from 'node:util';
// Trusted local operator boundary. No HTTP exposure or production activation.
export function createTaskIntake({store,enqueueSpec,policy,clock=Date.now}){
 if(!store||typeof store.transact!=='function'||typeof enqueueSpec!=='function')throw Error('intake dependencies required');
 const p=structuredClone(policy);
 const positive=n=>Number.isSafeInteger(n)&&n>0;
 if(!p||typeof p.repository!=='string'||!/^[-\w.]+\/[-\w.]+$/.test(p.repository)||! /^[a-f0-9]{40}$/.test(p.baseCommit)||!Array.isArray(p.allowedPaths)||!p.allowedPaths.length||p.allowedPaths.some(x=>typeof x!=='string'||! /^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(x)||x.split('/').some(v=>['.','..','.git'].includes(v.toLowerCase())))||typeof p.testPlanId!=='string'||!p.testPlanId||!positive(p.expiresAt)||!p.limits||!['maxAttempts','maxReviewAttempts','deadlineMs','maxPatchBytes'].every(k=>positive(p.limits[k])))throw Error('invalid operator policy');
 return async request=>{
  const now=clock();
  if(!Number.isSafeInteger(now)||now>=p.expiresAt)throw Error('operator authorization expired');
  if(!request||Object.keys(request).some(k=>!['id','goal','repository','baseCommit','allowedPaths','testPlanId'].includes(k))||typeof request.id!=='string'||! /^[a-zA-Z0-9_-]{1,80}$/.test(request.id)||typeof request.goal!=='string'||!request.goal.trim()||request.goal.length>16000||request.repository!==p.repository||request.baseCommit!==p.baseCommit||request.testPlanId!==p.testPlanId||!Array.isArray(request.allowedPaths)||!request.allowedPaths.length||!request.allowedPaths.every(x=>p.allowedPaths.includes(x)))throw Error('task outside authorized scope');
  const spec={version:1,id:request.id,role:'dev',goal:request.goal,deps:[],repository:p.repository,baseCommit:p.baseCommit,allowedPaths:[...new Set(request.allowedPaths)].sort(),testPlanId:p.testPlanId,limits:Object.fromEntries(['maxAttempts','maxReviewAttempts','deadlineMs','maxPatchBytes'].map(k=>[k,p.limits[k]]))};
  return store.transact(state=>{
   if(clock()>=p.expiresAt)throw Error('operator authorization expired');
   // JSONB can reorder object keys, including nested limits. Compare values, not serialization order.
   const matches=state.tasks.filter(t=>t.id===spec.id);
   if(Object.hasOwn(state.specs??{},spec.id)){
    if(!isDeepStrictEqual(state.specs[spec.id],spec)||matches.length!==1||matches[0].role!==spec.role||matches[0].goal!==spec.goal||!isDeepStrictEqual(matches[0].deps??[],spec.deps))throw Error('conflicting spec');
    return {id:spec.id,state:matches[0].state,disposition:'existing'};
   }
   if(matches.length)throw Error('conflicting spec: task without specification');
   const added=enqueueSpec(state,spec);
   return {id:spec.id,state:state.tasks.find(t=>t.id===spec.id).state,disposition:added?'created':'existing'};
  });
 };
}
