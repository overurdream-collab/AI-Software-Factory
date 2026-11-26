import {authorize} from './policy.mjs';
import {planRoute} from './router.mjs';
// Deterministic executive intake. No LLM authority, external effects or credentials.
const departments=Object.freeze({coding:'software-factory',analysis:'research',review:'independent-qa'});
export function prepareAssignment({request,grant,routes,now}={}) {
  if (!request || !authorize(grant,{...request,action:'submit'},now)) return {state:'denied'};
  if (!Object.hasOwn(departments,request.kind) ||
      !['simple','complex'].includes(request.complexity) ||
      request.sensitivity !== 'public' ||
      typeof request.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(request.id) ||
      typeof request.goal !== 'string' || !request.goal.trim() || Buffer.byteLength(request.goal)>8192)
    return {state:'denied'};
  const route=planRoute(routes,request,now);
  return {version:1,id:request.id,repository:request.repository,goal:request.goal,
    department:departments[request.kind],kind:request.kind,complexity:request.complexity,
    sensitivity:request.sensitivity,additionalBudgetMicros:0,createdAt:now,
    ...route,requiresIndependentReview:true};
}
// A route selection is not proof of execution. Factory adapter owns actual dispatch.
export function projectSummary(assignments) {
  const counts={ready:0,queued:0,denied:0,unknown:0};
  for(const a of assignments) {
    const k=['ready','queued','denied'].includes(a?.state)?a.state:'unknown';
    counts[k]++;
  }
  return {total:assignments.length,counts};
}
