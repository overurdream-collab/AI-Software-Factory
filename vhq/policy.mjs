// Pure policy; grants must originate from authenticated owner, never model input.
export function authorize(grant, request, now) {
  if (!grant || !request || !Number.isSafeInteger(now)) return false;
  if (!['read','submit'].includes(request.action)) return false;
  if (grant.action !== request.action || grant.repository !== request.repository) return false;
  if (typeof request.repository !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(request.repository)) return false;
  if (!Number.isSafeInteger(grant.expiresAt) || now >= grant.expiresAt) return false;
  return request.paid === false && request.production === false;
}
export function status(record) {
  if (!record || !record.available) return 'blocked';
  if (record.delivery === 'delivered') {
    return record.accepted === true && record.independentEvidence === true &&
      typeof record.commit === 'string' && /^[a-f0-9]{40}$/.test(record.commit) &&
      record.commit === record.checkedCommit ? 'delivered' : 'unverified';
  }
  if (record.accepted === true) return 'awaiting-delivery';
  return ['queued','running','blocked','failed'].includes(record.state) ? record.state : 'unknown';
}
