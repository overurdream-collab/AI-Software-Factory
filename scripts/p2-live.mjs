import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {SQLiteStore} from '../src/sqlite-store.mjs';
import {enqueueSpec,getDelivery} from '../src/attempt-store.mjs';
import {enqueue} from '../src/intake.mjs';
import {claim,submit} from '../src/leases.mjs';
import {reserveReview,finishReview} from '../src/review-lease.mjs';
import {tick} from '../src/worker-loop.mjs';
import {withHeartbeat} from '../src/heartbeat.mjs';
import {executeLiveRepository} from '../src/repository-worker.mjs';
import {git} from '../src/workspace.mjs';
import {verifyRepositoryArtifact} from './acceptance.mjs';
import {githubRemote,prepareRemotePatch,deliverDurable,deliveryKey} from '../src/github-delivery.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const repository = 'overurdream-collab/AI-Software-Factory';
const repositoryPath = resolve('.');
const stateRoot = resolve(process.env.P2_STATE_DIR || '/tmp/factory-p2-state');
const root = join(stateRoot, 'work');
const phase = process.argv[2];
const model = 'qwen2.5-coder:1.5b';
const verifier = 'p2-independent-F';
const checkName = 'Factory live pilot acceptance';
const runnerLimits = {timeoutMs: 60000, memoryMb: 256, cpus: 1, pids: 64, maxOutputBytes: 262144};
await mkdir(root, {recursive: true});
const write = (name, value) => writeFile(join(stateRoot,name), JSON.stringify(value,null,2)+'\n', {mode: 0o600});
const contextPath = join(stateRoot,'context.json');
const dbPath = join(stateRoot,'state.sqlite');
let context;
try { context = JSON.parse(await readFile(contextPath,'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }

async function exportState(store) {
  // No GitHub credentials are ever placed in the state or candidate workspace.
  const state = await store.transact(s => structuredClone(s));
  await write('state-summary.json', {
    tasks: state.tasks.map(({id,state,attemptId,attempts})=>({id,state,attemptId,attempts})),
    repositoryEvidence: state.repositoryEvidence, deliveries: state.deliveries,
    attempts: state.attempts?.map(({token,...a})=>a)
  });
}
async function localJson(path) {
  const response = await fetch('http://127.0.0.1:11434'+path, {signal: AbortSignal.timeout(5000), redirect:'error'});
  if (!response.ok) throw Error('Ollama metadata unavailable');
  return response.json();
}
async function checkAPI(token, head, passed, evidence) {
  const response = await fetch('https://api.github.com/repos/'+repository+'/check-runs', {
    method:'POST', redirect:'error', signal:AbortSignal.timeout(15000),
    headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},
    body:JSON.stringify({name:checkName,head_sha:head,status:'completed',
      conclusion:passed?'success':'failure',completed_at:new Date().toISOString(),
      details_url:'https://github.com/'+repository+'/actions/runs/'+process.env.GITHUB_RUN_ID,
      output:{title:passed?'Independent F tests passed on the exact PR head':'Independent F verification failed',
        summary:JSON.stringify({testedCommit:head,candidateTree:evidence.candidateTree,tests:evidence.tests,logs:evidence.logs})}})
  });
  if (!response.ok) throw Error('check publication HTTP '+response.status);
  const result = await response.json();
  assert.equal(result.head_sha,head);
  return result.id;
}

if (phase === 'repair') {
  const baseCommit = (await git(repositoryPath,['rev-parse','HEAD'])).trim();
  const baseBranch = process.env.GITHUB_REF_NAME;
  assert.match(baseBranch || '', /^coord\/p2-live-integration-v[0-9]+$/);
  const imageDigest = process.env.P2_IMAGE_DIGEST;
  assert.match(imageDigest || '', /^sha256:[a-f0-9]{64}$/);
  if (context) {
    assert.equal(context.spec.baseCommit,baseCommit,'checkpoint must match this source revision');
    const reopened = new SQLiteStore(dbPath);
    try {
      const task = await reopened.transact(s=>s.tasks.find(t=>t.id===context.spec.id));
      assert.equal(task?.state,'accepted','resume requires an independently accepted checkpoint');
      assert.equal(hash(task.artifact),context.artifactSha256);
      console.log(JSON.stringify({phase:'repair-resumed',baseCommit,artifactSha256:context.artifactSha256}));
    } finally {reopened.close();}
  } else {
    const [version,tags] = await Promise.all([localJson('/api/version'),localJson('/api/tags')]);
    const installed = tags.models.find(x=>x.name===model || x.model===model);
    assert.ok(installed?.digest,'actual installed model digest required');
    const spec = {version:1,id:'p2-live-'+baseCommit.slice(0,12),role:'dev',deps:[],
      repository,baseCommit,allowedPaths:['fixtures/p2-clamp/clamp.mjs'],testPlanId:'p2-clamp-v1',
      goal:'The current clamp implementation ignores the lower bound. Fix clamp(value, lower, upper) to enforce BOTH bounds: return lower below the lower bound, upper above the upper bound, and the original value inside the interval. Preserve the named ES module export clamp. Return only the complete revised JavaScript source. Do not change tests or create other files.',
      limits:{maxAttempts:2,maxReviewAttempts:4,deadlineMs:300000,maxPatchBytes:16384}};
    context = {version:1,spec,baseBranch,imageDigest,model,providerObservation:{
      serverVersion:version.version,modelDigest:installed.digest,observedAt:new Date().toISOString()},
      sourceRevision:baseCommit,startedAt:new Date().toISOString()};
    const store = new SQLiteStore(dbPath);
    try {
      await store.transact(s=>enqueueSpec(s,spec));
      const result = await tick({store,role:'dev',worker:'p2-live-B',reviewer:verifier,
        ttl:60000,deadlineMs:300000,maxAttempts:2,maxReviewAttempts:4,
        execute:async(task,signal)=>{try{return await executeLiveRepository({spec,attemptId:task.attemptId,
          leaseToken:task.token,owner:task.worker,store,repositoryPath,root,
          testPlan:{id:'p2-clamp-v1',commands:[{argv:['node','--test','--test-reporter=tap','fixtures/p2-clamp/checks.mjs'],cwd:'.'}]},
          runnerLimits,imageDigest,providerConfig:{model,timeoutMs:120000},
          approvedRepositories:[repository],signal});}catch(error){
            await write('execution-failure.json',{name:error.name,message:error.message});
            console.error(JSON.stringify({phase:'B-execution-failed',name:error.name,message:error.message}));
            throw error;
          }},
        verify:(task,signal)=>verifyRepositoryArtifact({spec,artifact:task.artifact,
          repositoryPath,root,store,attemptId:task.attemptId,leaseToken:task.reviewToken,
          owner:verifier,imageDigest,runnerLimits,signal,logRoot:join(stateRoot,'f-logs')})
      });
      assert.equal(result.state,'accepted','live repair and independent verification must both pass');
      const task = await store.transact(s=>structuredClone(s.tasks.find(t=>t.id===spec.id)));
      context.artifactSha256 = hash(task.artifact);
      context.artifact = JSON.parse(task.artifact);
      context.acceptedAt = new Date().toISOString();
      await write('context.json',context);
      await exportState(store);
      console.log(JSON.stringify({phase:'repair-accepted',taskId:spec.id,artifactSha256:context.artifactSha256,
        candidateTree:context.artifact.candidateTree,provider:context.providerObservation}));
    } catch (error) {
      await exportState(store);
      // Error messages from provider/worker are fixed control-plane messages; no raw candidate stdout is printed.
      console.error(JSON.stringify({phase:'repair-failed',name:error.name,message:error.message}));
      throw error;
    } finally {store.close();}
  }
} else if (phase === 'deliver') {
  assert.ok(context,'repair checkpoint required');
  assert.equal(process.env.GITHUB_REPOSITORY,repository);
  const token = process.env.GITHUB_TOKEN;
  assert.ok(token,'trusted host GitHub credential required');
  const {spec,imageDigest,baseBranch} = context;
  const store = new SQLiteStore(dbPath);
  const remote = githubRemote({token,allowlist:[repository]});
  const prepare = prepareRemotePatch({remote,repositoryPath,root});
  const args = {store,taskId:spec.id,owner:'p2-C-delivery',ttlMs:300000,allowlist:[repository],
    approvedVerifierIds:[verifier],remote,prepare,baseBranch,requiredChecks:[checkName]};
  const key = deliveryKey(spec);
  const branch = 'factory/'+hash(key);
  try {
    const original = await store.transact(s=>s.tasks.find(t=>t.id===spec.id));
    assert.equal(original.state,'accepted');
    assert.equal(hash(original.artifact),context.artifactSha256);
    console.log(JSON.stringify({phase:'checkpoint-restored-in-new-process',taskId:spec.id,artifactSha256:context.artifactSha256}));
    let result = await deliverDurable(args);
    if (result?.state !== 'delivered') {
      assert.equal(result?.state,'pending','PR must exist before head verification');
      const head = result.commitSha;
      await git(repositoryPath,['fetch','--no-tags','origin',
        'refs/heads/'+result.branch+':refs/remotes/origin/'+result.branch]);
      assert.equal((await git(repositoryPath,['rev-parse','refs/remotes/origin/'+result.branch])).trim(),head);
      const auditId = 'head-'+spec.baseCommit.slice(0,12)+'-'+head.slice(0,12);
      await store.transact(s=>enqueue(s,[{id:auditId,role:'audit',goal:'Independent verification of delivered GitHub head',deps:[]}]));
      let audit = await store.transact(s=>claim(s,'audit','p2-head-F',Date.now(),60000,3));
      if (!audit) {
        const prior = await store.transact(s=>s.tasks.find(t=>t.id===auditId));
        assert.equal(prior?.state,'accepted','head audit unavailable');
        // A completed prior audit can be reused only through its exact published check.
      } else {
        const verdict = await withHeartbeat({store,task:audit,owner:audit.worker,clock:Date.now,ttl:60000,deadlineMs:120000,
          operation:(_task,signal)=>verifyRepositoryArtifact({spec,artifact:original.artifact,
            repositoryPath,root,store,attemptId:context.artifact.attemptId,
            runnerTaskId:audit.id,runnerAttemptId:audit.attemptId,leaseToken:audit.token,
            owner:audit.worker,imageDigest,runnerLimits,signal,testedCommit:head,
            logRoot:join(stateRoot,'head-logs')})});
        const evidence = JSON.parse(verdict.evidence);
        const checkRunId = await checkAPI(token,head,verdict.passed,evidence);
        await store.transact(s=>{
          submit(s,audit.id,audit.token,verdict.evidence,Date.now());
          const reservation=reserveReview(s,'audit','p2-head-evidence-review',Date.now(),60000,audit.id,2);
          finishReview(s,audit.id,reservation.reviewToken,Date.now(),verdict.passed,
            JSON.stringify({checkRunId,testedCommit:head,evidenceSha256:hash(verdict.evidence)}),3);
        });
        assert.equal(verdict.passed,true,'exact delivered head must pass independent verification');
        context.headVerification={head,checkRunId,tests:evidence.tests,evidenceSha256:hash(verdict.evidence)};
        await write('context.json',context);
      }
      result = await deliverDurable(args);
    }
    assert.equal(result?.state,'delivered');
    assert.equal(result.checkedCommit,result.commitSha);
    const replay = await deliverDurable(args);
    assert.equal(replay.prNumber,result.prNumber,'retry must return the same PR');
    assert.equal(replay.commitSha,result.commitSha);
    context.delivery=result;
    context.finishedAt=new Date().toISOString();
    context.restartRecoveryVerified=true;
    context.deliveryReplayVerified=true;
    await write('context.json',context);
    await write('result.json',{...context,accepted:true,paidProviderUsed:false,automaticMerge:false,
      twoLiveWorkersVerified:false,continuous24HoursVerified:false});
    await exportState(store);
    console.log(JSON.stringify({phase:'delivered',...result,restartRecoveryVerified:true,deliveryReplayVerified:true}));
  } catch (error) {
    const head = await remote.ref(repository,branch).catch(()=>null);
    const pending={phase:'delivery-blocked',repository,baseBranch,branch,head,message:error.message,
      saved:getDelivery(await store.transact(s=>structuredClone(s)),key)};
    await write('delivery-blocker.json',pending);
    await exportState(store);
    console.error(JSON.stringify(pending));
    throw error;
  } finally {store.close();}
} else {
  throw Error('phase must be repair or deliver');
}
