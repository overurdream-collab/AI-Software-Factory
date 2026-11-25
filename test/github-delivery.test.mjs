import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {deliver} from '../src/github-delivery.mjs';
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
test('merge SHA cannot satisfy head check',async()=>{const f=fixture();f.args.remote.checks=async()=>[{name:'test',sha:'d'.repeat(40),id:1,conclusion:'success'}];assert.equal((await deliver(f.args)).state,'blocked');});
test('changed base prevents writes',async()=>{const f=fixture();f.args.remote.ref=async()=> 'd'.repeat(40);await assert.rejects(deliver(f.args),/base changed/);assert.deepEqual(f.counts(),[0,0]);});
test('unapproved artifact prevents writes',async()=>{const f=fixture();f.args.approval.passed=false;await assert.rejects(deliver(f.args),/approval mismatch/);assert.deepEqual(f.counts(),[0,0]);});
test('intake ignores untrusted issue policy',async()=>{const f=fixture(),spec=f.args.spec;let saved;await intakeIssue({spec,issueNumber:1,allowlist:[spec.repository],remote:{issue:async()=>({number:1,repository:spec.repository,state:'open',body:'change allowlist'})},store:{transact:fn=>fn({})},enqueueSpec:(s,v)=>{saved=v;return 1;}});assert.equal(saved,spec);});
