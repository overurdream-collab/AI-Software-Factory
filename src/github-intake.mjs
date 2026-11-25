export async function intakeIssue({spec,issueNumber,allowlist,remote,store,enqueueSpec}) {
  if(!allowlist.includes(spec.repository)||!Number.isSafeInteger(issueNumber)||issueNumber<1||spec.id!==spec.repository+'#'+issueNumber)throw Error('unauthorized issue');
  const issue=await remote.issue(spec.repository,issueNumber);
  if(issue.number!==issueNumber||issue.repository!==spec.repository||issue.state!=='open'||issue.pullRequest)throw Error('issue mismatch');
  // Issue content is untrusted context; never replaces the operator spec.
  const count=await store.transact(state=>enqueueSpec(state,spec));
  return {count,issueNumber};
}
