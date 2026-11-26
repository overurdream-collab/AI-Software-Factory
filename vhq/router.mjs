// Pure routing policy. Route metadata must come from trusted operator configuration
// and verified provider catalog/quotas, not from model output or task text.
export function selectRoutes(routes, task, now) {
  if (!Array.isArray(routes) || !task || !Number.isSafeInteger(now) ||
      !['coding','analysis','review'].includes(task.kind) ||
      !['simple','complex'].includes(task.complexity) ||
      task.sensitivity !== 'public') return [];
  return routes.filter(r => r && typeof r.id === 'string' && r.id.length &&
    ['codex','opencode','deepseek'].includes(r.client) &&
    r.enabled === true && r.verified === true && r.noChargeEnforced === true &&
    r.remainingRequests > 0 && Number.isSafeInteger(r.remainingRequests) &&
    Number.isSafeInteger(r.validUntil) && r.validUntil > now &&
    (r.cooldownUntil === undefined || (Number.isSafeInteger(r.cooldownUntil) && r.cooldownUntil <= now)) &&
    Array.isArray(r.capabilities) && r.capabilities.includes(task.kind) &&
    ['free','included','trial'].includes(r.billing) &&
    (r.billing !== 'trial' || (Number.isSafeInteger(r.creditExpiresAt) && r.creditExpiresAt > now &&
      Number.isSafeInteger(r.creditRemainingMicros) && r.creditRemainingMicros > 0)))
    .sort((a,b) => rank(a,task)-rank(b,task) || a.id.localeCompare(b.id));
}
function rank(r,t) {
  const preference = t.kind === 'coding' && t.complexity === 'complex'
    ? ['codex','opencode','deepseek'] : t.kind === 'coding'
    ? ['opencode','codex','deepseek'] : ['deepseek','opencode','codex'];
  return preference.indexOf(r.client);
}
// Only a confirmed rejection before execution permits immediate fallback.
// Ambiguous timeouts must be reconciled; never duplicate external effects.
export function routeOutcome(result) {
  if (result?.kind === 'success') return 'awaiting-independent-review';
  if (result?.kind === 'quota' && result?.executionStarted === false) return 'rotate';
  return 'blocked-reconcile';
}
export function planRoute(routes,task,now) {
  const candidates = selectRoutes(routes,task,now);
  return candidates.length ? {state:'ready',routeId:candidates[0].id} :
    {state:'queued',reason:'no-verified-no-charge-route'};
}
