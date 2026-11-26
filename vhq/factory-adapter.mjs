import {authorize} from './policy.mjs';
import {planRoute} from './router.mjs';
import {createHash} from 'node:crypto';
const oid=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const safePath=x=>typeof x==='string'&&x.length<=512&&x.split('/').every(p=>p&&p!=='.'&&p!=='..'&&p.toLowerCase()!=='.git'&&/^[a-zA-Z0-9_.-]+$/.test(p));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
// Pure boundary: profile, grants, route metadata and dependency evidence must come from trusted services.
export function prepareFactoryDispatch({assignment:a,grant,profile:p,routes,now,dependencies=[]}={}){
  if(!a||a.kind!=='coding'||!['ready','queued'].includes(a.state)||
     a.additionalBudgetMicros!==0||!authorize(grant,{action:'submit',repository:a.repository,paid:false,production:false},now))return {state:'denied'};
  if(!Array.isArray(a.deps)||!Array.isArray(dependencies)||!a.deps.every(id=>dependencies.some(d=>d.id===id&&d.projectId===a.projectId&&d.accepted===true&&d.delivery==='delivered'&&oid(d.commit)&&d.commit===d.checkedCommit&&d.independentEvidence===true)))return {state:'blocked',reason:'dependencies'};
  if(!p||p.repository!==a.repository||!oid(p.baseCommit)||!Array.isArray(p.allowedPaths)||!p.allowedPaths.length||!p.allowedPaths.every(safePath)||typeof p.testPlanId!=='string'||!p.testPlanId||!p.limits||!['maxAttempts','maxReviewAttempts','deadlineMs','maxPatchBytes'].every(k=>Number.isSafeInteger(p.limits[k])&&p.limits[k]>0))return {state:'blocked',reason:'trusted-profile-required'};
  const route=planRoute(routes,a,now);
  if(route.state!=='ready')return route;
  const spec={version:1,id:a.id,role:'dev',goal:a.goal,deps:[...a.deps],repository:a.repository,baseCommit:p.baseCommit,allowedPaths:[...p.allowedPaths],testPlanId:p.testPlanId,limits:Object.fromEntries(['maxAttempts','maxReviewAttempts','deadlineMs','maxPatchBytes'].map(k=>[k,p.limits[k]]))};
  return {state:'dispatch-planned',spec,routeId:route.routeId,dispatchKey:hash([a.repository,a.id]),specDigest:hash(spec)};
}
// No network call here. A real transport must persist dispatch intent, reconcile ambiguous responses,
// and enforce authorization and no-charge policy again at execution time.
