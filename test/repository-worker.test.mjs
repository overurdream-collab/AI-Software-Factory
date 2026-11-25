import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,readdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
import {repairRepository} from '../src/repository-worker.mjs';
import {git,safePath,createWorkspace,sourceFile} from '../src/workspace.mjs';
const exec=promisify(execFile);
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'b-fixture-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const repo=join(dir,'repo'),root=join(dir,'work');await mkdir(repo);await mkdir(root);
 await git(repo,['init','-q']);await git(repo,['config','user.name','Fixture']);await git(repo,['config','user.email','fixture@example.invalid']);
 await writeFile(join(repo,'math.mjs'),'export const add=(a,b)=>a-b;\n');
 await writeFile(join(repo,'math.test.mjs'),"import {test} from 'node:test';import assert from 'node:assert/strict';import {add} from './math.mjs';test('bug',()=>assert.equal(add(2,3),5));test('regression zero',()=>assert.equal(add(5,0),5));test('regression negative',()=>assert.equal(add(-2,3),1));\n");
 await symlink('math.mjs',join(repo,'alias.mjs'));await git(repo,['add','.']);await git(repo,['commit','-qm','fixture']);
 const baseCommit=(await git(repo,['rev-parse','HEAD'])).trim(),commands=[{argv:[process.execPath,'--test','math.test.mjs'],cwd:'.'}],evidence=[];
 // Trusted fixture only: real child processes, NOT a production sandbox.
 const runProject=async({workspace,commands,signal})=>({runtime:'local-fixture-not-sandbox',imageDigest:null,commands:await Promise.all(commands.map(async c=>{try{const r=await exec(c.argv[0],c.argv.slice(1),{cwd:workspace,signal,env:{PATH:process.env.PATH}});return {...c,exitCode:0,...r};}catch(e){if(!Number.isInteger(e.code))throw e;return {...c,exitCode:e.code,stdout:e.stdout,stderr:e.stderr};}}))});
 return {repo,root,evidence,args:{root,repositoryPath:repo,attemptId:'fixture-attempt',spec:{version:1,id:'fix',role:'dev',repository:'local/fixture',baseCommit,goal:'fix addition',allowedPaths:['math.mjs'],testPlanId:'math',limits:{maxAttempts:2,maxPatchBytes:4096,deadlineMs:30000}},testPlan:{id:'math',commands},runnerLimits:{timeoutMs:5000},generate:async()=> 'export const add=(a,b)=>a+b;\n',runProject,onEvidence:async e=>evidence.push(e)}};
}
test('real red/green fixture, retry, artifact replay and cleanup',async t=>{
 const {args,repo,root,evidence}=await fixture(t);let calls=0;
 args.generate=async()=>++calls===1?'export const add=(a,b)=>a*b;\n':'export const add=(a,b)=>a+b;\n';
 const artifact=JSON.parse(await repairRepository(args));assert.equal(calls,2);assert.deepEqual(evidence.map(e=>e.result.commands[0].exitCode),[1,1,0]);
 assert.match(evidence[0].result.commands[0].stdout,/# fail 2/);assert.match(evidence[2].result.commands[0].stdout,/# pass 3/);
 assert.equal(artifact.patchSha256,createHash('sha256').update(artifact.patch).digest('hex'));assert.deepEqual(artifact.changedPaths,['math.mjs']);assert.deepEqual(await readdir(root),[]);
 const w=await createWorkspace({root,repositoryPath:repo,baseCommit:args.spec.baseCommit});try{await writeFile(join(w.workspace,'change.diff'),artifact.patch);await git(w.workspace,['apply','--index','change.diff']);assert.equal((await git(w.workspace,['write-tree'])).trim(),artifact.candidateTree);}finally{await w.cleanup();}
 assert.match(await readFile(join(repo,'math.mjs'),'utf8'),/a-b/);
});
test('reject traversal and acceptance paths',()=>{for(const p of ['../a','/a','.git/config','test/acceptance/a.mjs','math.test.mjs','a\\b'])assert.throws(()=>safePath(p));});
test('reject tracked symlink and wrong base',async t=>{const {args,repo,root}=await fixture(t);await assert.rejects(createWorkspace({root,repositoryPath:repo,baseCommit:'a'.repeat(40)}));args.spec.allowedPaths=['alias.mjs'];await assert.rejects(repairRepository(args),/regular file/);assert.deepEqual(await readdir(root),[]);});
test('reject passing baseline and incomplete runner response',async t=>{const {args}=await fixture(t);args.runProject=async({commands})=>({commands:commands.map(c=>({...c,exitCode:0}))});await assert.rejects(repairRepository(args),/baseline did not/);args.runProject=async()=>({commands:[]});await assert.rejects(repairRepository(args),/incomplete/);});
test('bounded retries and cleanup',async t=>{const {args,root}=await fixture(t);let n=0;args.generate=async()=> 'export const add=(a,b)=>a-b+'+(++n)+';\n';await assert.rejects(repairRepository(args),/exhausted/);assert.equal(n,2);assert.deepEqual(await readdir(root),[]);});
test('reject runner mutation and pre-abort',async t=>{const {args,root}=await fixture(t);const run=args.runProject;args.runProject=async x=>{const r=await run(x);await writeFile(join(x.workspace,'math.test.mjs'),'');return r;};await assert.rejects(repairRepository(args),/changed baseline/);await assert.rejects(repairRepository({...args,signal:AbortSignal.abort()}));assert.deepEqual(await readdir(root),[]);});
