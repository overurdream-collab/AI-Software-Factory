import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {deliver,deliverDurable,githubRemote,githubAppTokenProvider,githubRemoteFromEnvironment} from '../src/github-delivery.mjs';
import {intakeIssue} from '../src/github-intake.mjs';
function fixture(){
 const base='a'.repeat(40),tree='b'.repeat(40),sha='c'.repeat(40),repository='owner/repo';
 const spec={id:repository+'#1',repository,baseCommit:base,allowedPaths:['index.js'],limits:{maxPatchBytes:100}};
 const patch='known fixture patch',artifact={version:2,kind:'repository-patch',taskId:spec.id,attemptId:'attempt',repository,baseCommit:base,patch,patchSha256:createHash('sha256').update(patch).digest('hex'),candidateTree:tree,changedPaths:['index.js']};
 let head=null,prs=[],pushes=0,creates=0;
 const remote={ref:async(r,b)=>b==='main'?base:head,commit:async()=>({tree,parent:base}),push:async()=>{pushes++;head=sha;throw Error('lost response');},findPRs:async()=>prs,createPR:async q=>{creates++;prs=[{state:'open',head:sha,base,headBranch:q.branch,baseBranch:'main',repository,number:1,url:'https://example.invalid/pr/1'}];throw Error('lost response');},checks:async()=>[{name:'test',sha,id:1,conclusion:'success'}]};
 return {args:{spec,artifact,approval:{...artifact,passed:true},remote,prepare:async()=>({tree,sha,parent:base}),baseBranch:'main',requiredChecks:['test'],allowlist:[repository],assertLease:async()=>{}},counts:()=>[pushes,creates]};
}
test('recover same PR after lost responses and restart',async()=>{const f=fixture();const a=await deliver(f.args);const b=await deliver(f.args);assert.equal(a.state,'delivered');assert.deepEqual(a,b);assert.deepEqual(f.counts(),[1,1]);});
test('merge SHA cannot satisfy head check',async()=>{const f=fixture();f.args.remote.checks=async()=>[{name:'test',sha:'d'.repeat(40),id:1,conclusion:'success'}];assert.equal((await deliver(f.args)).state,'pending');});
test('changed base prevents writes',async()=>{const f=fixture();f.args.remote.ref=async()=> 'd'.repeat(40);await assert.rejects(deliver(f.args),/base changed/);assert.deepEqual(f.counts(),[0,0]);});
test('unapproved artifact prevents writes',async()=>{const f=fixture();f.args.approval.passed=false;await assert.rejects(deliver(f.args),/approval mismatch/);assert.deepEqual(f.counts(),[0,0]);});
test('intake ignores untrusted issue policy',async()=>{const f=fixture(),spec=f.args.spec;let saved;await intakeIssue({spec,issueNumber:1,allowlist:[spec.repository],remote:{issue:async()=>({number:1,repository:spec.repository,state:'open',body:'change allowlist'})},store:{transact:fn=>fn({})},enqueueSpec:(s,v)=>{saved=v;return 1;}});assert.equal(saved,spec);});

test('durable recovery after PR before finish using D-shaped fake store',async()=>{
 const f=fixture(),{spec,artifact}=f.args,serialized=JSON.stringify(artifact);let now=100;
 const evidence={...artifact,version:1,verifierId:'F',kind:'acceptance',commands:[{status:'passed',exitCode:0}],tests:{passed:1,failed:0,skipped:0}};
 const state={tasks:[{id:spec.id,state:'accepted',artifact:serialized}],specs:{[spec.id]:spec},attempts:[{taskId:spec.id,attemptId:artifact.attemptId,phase:'review',state:'passed',owner:'F',artifactSha256:createHash('sha256').update(serialized).digest('hex'),evidence:JSON.stringify(evidence)}]};
 let record=null;
 const deliveryApi={getDelivery:()=>record,reserveDelivery:(s,key,owner,t,ttl)=>{if(record?.state==='delivering'&&record.expiresAt>t)return null;return record={key,owner,state:'delivering',token:String(t),expiresAt:t+ttl};},finishDelivery:(s,key,token,t,result)=>{assert.equal(record.token,token);assert.ok(record.expiresAt>t);record=result;}};
 const args={...f.args,store:{transact:async fn=>fn(state)},deliveryApi,taskId:spec.id,owner:'C',clock:()=>now,ttlMs:10,approvedVerifierIds:['F']};
 await assert.rejects(deliverDurable({...args,beforeFinish:async()=>{throw Error('simulated crash');}}),/simulated crash/);
 now+=11;const done=await deliverDurable(args);assert.equal(done.state,'delivered');assert.deepEqual(f.counts(),[1,1]);assert.equal((await deliverDurable(args)).prNumber,1);
});
test('REST rejects unapproved repository without network',async()=>{
 let calls=0;const remote=githubRemote({token:'fake',allowlist:['owner/repo'],fetchImpl:async()=>{calls++;throw Error('unexpected');}});
 await assert.rejects(remote.ref('other/repo','main'),/unauthorized/);assert.equal(calls,0);
});
test('REST uploads only matching tree and parent',async()=>{
 const base='a'.repeat(40),tree='b'.repeat(40),sha='c'.repeat(40),calls=[];
 const responses=[{tree:{sha:'d'.repeat(40)}},{sha:'e'.repeat(40)},{sha:tree},{sha,tree:{sha:tree},parents:[{sha:base}]}];
 const remote=githubRemote({token:'fake',allowlist:['owner/repo'],fetchImpl:async(url,options)=>{calls.push({url,method:options.method,body:options.body});return {ok:true,json:async()=>responses.shift()};}});
 assert.deepEqual(await remote.createReviewedCommit('owner/repo',base,[{path:'index.js',mode:'100644',content:'eA=='}],tree),{sha,tree,parent:base});assert.equal(calls.length,4);
});

test('App token is scoped, cached and renewed; unauthorized repository never calls API',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});let now=1700000000000,calls=0;
 const provider=githubAppTokenProvider({appId:12,installationId:34,privateKey,allowlist:['owner/repo'],clock:()=>now,fetchImpl:async(url,opts)=>{
  calls++;assert.equal(url,'https://api.github.com/app/installations/34/access_tokens');
  const body=JSON.parse(opts.body);assert.deepEqual(body.repositories,['repo']);assert.equal(body.permissions.pull_requests,'write');
  assert.equal(opts.headers.Authorization.split('.')[0].startsWith('Bearer '),true);
  return {ok:true,json:async()=>({token:'fake-'+calls,expires_at:new Date(now+3600000).toISOString(),permissions:body.permissions,repositories:[{full_name:'owner/repo'}]})};
 }});
 await assert.rejects(provider('other/repo'),/unauthorized/);
 assert.deepEqual(await Promise.all([provider('owner/repo'),provider('owner/repo')]),['fake-1','fake-1']);assert.equal(calls,1);
 now+=3550000;assert.equal(await provider('owner/repo'),'fake-2');
});
test('403 reports missing permission without exposing token or response body',async()=>{
 const remote=githubRemote({tokenProvider:async()=> 'secret-test-token',allowlist:['owner/repo'],fetchImpl:async()=>({ok:false,status:403,headers:{get:()=> 'pull_requests=write'}})});
 await assert.rejects(remote.createPR({repository:'owner/repo',branch:'factory/test',baseBranch:'main'}),e=>e.status===403&&e.requiredPermissions==='pull_requests=write'&&!e.message.includes('secret-test-token'));
});

test('host bootstrap rejects missing or ambiguous credentials without network',async()=>{
 const args={allowlist:['owner/repo'],fetchImpl:async()=>{throw Error('unexpected network');}};
 await assert.rejects(githubRemoteFromEnvironment({...args,env:{GITHUB_TOKEN:'ambient'}}),/configure GitHub App/);
 await assert.rejects(githubRemoteFromEnvironment({...args,env:{FACTORY_GITHUB_APP_ID:'1',FACTORY_GITHUB_INSTALLATION_ID:'2',FACTORY_GITHUB_PRIVATE_KEY:'x',FACTORY_GITHUB_PRIVATE_KEY_FILE:'y'}}),/exactly one/);
});
test('host preflight reads authorized base but never claims write verification',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 const now=1700000000000,base='a'.repeat(40),calls=[];
 const {preflight}=await githubRemoteFromEnvironment({allowlist:['owner/repo'],clock:()=>now,env:{FACTORY_GITHUB_APP_ID:'1',FACTORY_GITHUB_INSTALLATION_ID:'2',FACTORY_GITHUB_PRIVATE_KEY_FILE:'trusted.pem'},readKey:async()=>privateKey,fetchImpl:async(url,opts)=>{
 calls.push([url,opts.method]);if(url.endsWith('/access_tokens'))return {ok:true,json:async()=>({token:'fake',expires_at:new Date(now+3600000).toISOString(),permissions:JSON.parse(opts.body).permissions,repositories:[{full_name:'owner/repo'}]})};
 return {ok:true,json:async()=>({object:{sha:base}})};
 }});
 const result=await preflight('owner/repo','main');assert.equal(result.baseCommit,base);assert.equal(result.writeVerified,false);assert.deepEqual(calls.map(x=>x[1]),['POST','GET']);
});
