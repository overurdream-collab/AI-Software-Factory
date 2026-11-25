import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {digest} from './patch-adapter.mjs';

// Fixed runtime and command; generated source is stdin only.
// Docker must be operated on a trusted, dedicated host, not a production host.
// This is a constrained pilot, not a complete hostile-code isolation guarantee.
export function invoke(args,input,timeoutMs,signal,maxOutputBytes=65536){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const p=spawn('docker',args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let stdout='',stderr='',failure=null;
  const abort=()=>{failure=signal.reason??Error('sandbox aborted');p.kill('SIGKILL');};
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  const timer=setTimeout(()=>{failure=Error('sandbox timeout');p.kill('SIGKILL');},timeoutMs);
  const append=(old,chunk)=>{const next=old+chunk.toString('utf8');if(Buffer.byteLength(next)>maxOutputBytes){failure=Error('sandbox output limit');p.kill('SIGKILL');return old;}return next;};
  p.stdout.on('data',b=>{stdout=append(stdout,b);});
  p.stderr.on('data',b=>{stderr=append(stderr,b);});
  p.stdin.on('error',()=>{});
  const dispose=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  p.on('error',e=>{dispose();reject(e);});
  p.on('close',code=>{dispose();if(failure)reject(failure);else resolve({code,stdout,stderr});});
  p.stdin.end(input);
 });
}
export async function verifyExecutable({source,artifact,expected,timeoutMs=15000,signal}){
 if(typeof source!=='string'||typeof expected!=='string'||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw Error('invalid verifier input');
 const p=JSON.parse(artifact);
 if(p.version!==1||p.base!==digest(source)||typeof p.candidate!=='string'||Buffer.byteLength(p.candidate)>65536||p.sha!==digest(p.candidate))throw Error('invalid artifact');
 signal?.throwIfAborted();
 const name='factory-'+randomUUID();
 const args=['run','--rm','-i','--name',name,'--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=65534:65534','--pids-limit=32','--memory=128m','--memory-swap=128m','--cpus=0.5','--tmpfs','/tmp:rw,noexec,nosuid,size=8m','node:22-alpine','node','--input-type=module','-'];
 try{
  const result=await invoke(args,p.candidate,timeoutMs,signal);
  // External verifier owns expected output; candidate exit status alone is insufficient.
  if(result.code===125||result.code===126||result.code===127)throw Error('sandbox infrastructure failure');
  const passed=result.code===0&&result.stdout.trim()===expected;
  return {passed,evidence:JSON.stringify({sha:p.sha,passed,exitCode:result.code,stdoutSha:digest(result.stdout),expectedSha:digest(expected),runtime:'node:22-alpine',network:'none'})};
 }finally{
  // A killed Docker client may leave a container; always attempt cleanup.
  const cleanup=await invoke(['rm','-f',name],'',10000);
  if(cleanup.code!==0&&!cleanup.stderr.includes('No such container'))throw Error('sandbox cleanup failed');
 }
}


// D's resource API is injected only by the trusted host or imported on integration.
export function createProjectRunner({store,taskId,attemptId,leaseToken,owner,clock=Date.now,imageDigest,resourceApi}){
 if(!store||![taskId,attemptId,leaseToken,owner].every(x=>typeof x==='string'&&x.length)||
 !/^sha256:[a-f0-9]{64}$/.test(imageDigest))throw Error('invalid runner identity or image digest');
 return async function runProject({workspace,commands,signal,limits}){
  const {realpath,lstat,readdir}=await import('node:fs/promises');
  const {isAbsolute,join}=await import('node:path');
  const {timeoutMs,memoryMb,cpus,pids,maxOutputBytes}=limits;
  if(![timeoutMs,memoryMb,pids,maxOutputBytes].every(Number.isSafeInteger)||
 timeoutMs<100||timeoutMs>3600000||memoryMb<64||memoryMb>2048||pids<8||pids>256||
 maxOutputBytes<1024||maxOutputBytes>1048576||!Number.isFinite(cpus)||cpus<=0||cpus>4)throw Error('invalid limits');
  if(!Array.isArray(commands)||!commands.length||commands.length>32)throw Error('invalid commands');
  for(const c of commands){
   if(!Array.isArray(c.argv)||!c.argv.length||c.argv.some(a=>typeof a!=='string'||a.includes('\0'))||
 typeof c.cwd!=='string'||isAbsolute(c.cwd)||c.cwd.includes('\\')||c.cwd.split('/').some(p=>p==='..'||p==='.git'))throw Error('invalid command');
  }
  if(typeof workspace!=='string'||!isAbsolute(workspace)||(await lstat(workspace)).isSymbolicLink())throw Error('invalid workspace');
  const root=await realpath(workspace);
  if(root.includes(','))throw Error('unsupported workspace path');
  // B passes a sanitized staging tree, never its private Git checkout.
  let files=0,bytes=0;
  async function check(dir){for(const entry of await readdir(dir,{withFileTypes:true})){
   signal?.throwIfAborted();const n=entry.name;
   if(/^(?:\.git$|\.env(?:\.|$)|\.npmrc|\.netrc|id_rsa|id_ed25519|credentials(?:\.|$))/i.test(n)||/\.(?:pem|key|p12|pfx)$/i.test(n))throw Error('unsafe workspace entry');
   const p=join(dir,n),st=await lstat(p);
   if(++files>4000||st.isSymbolicLink()||(!st.isDirectory()&&!st.isFile()))throw Error('unsafe workspace tree');
   if(st.isDirectory())await check(p);else if((bytes+=st.size)>32*1024*1024)throw Error('workspace size limit');
  }}
  await check(root);
  const api=resourceApi??await import('./attempt-store.mjs');
  const id=randomUUID(),name='factory-project-'+id;
  const resource={id,taskId,attemptId,leaseToken,owner,kind:'docker',name,createdAt:clock()};
  const deadline=Date.now()+timeoutMs;
  const call=(args,independent=false)=>invoke(args,'',independent?10000:Math.max(1,deadline-Date.now()),independent?undefined:signal,maxOutputBytes);
  const requireOk=async(args)=>{const x=await call(args);if(x.code!==0)throw Error('Docker setup failed');return x;};
  signal?.throwIfAborted();
  await store.transact(s=>api.recordResource(s,resource));
  let containerId;
  try{
   const created=await requireOk(['create','--name',name,'--label','factory.runtime=project-v1','--label','factory.task='+taskId,'--label','factory.attempt='+attemptId,
    '--pull=never','--network=none','--read-only','--cap-drop=ALL','--security-opt=no-new-privileges','--user=65534:65534',
    '--pids-limit='+pids,'--memory='+memoryMb+'m','--memory-swap='+memoryMb+'m','--cpus='+cpus,
    '--tmpfs','/tmp:rw,nosuid,nodev,size=32m','--mount','type=bind,source='+root+',target=/workspace,readonly',
    '--tmpfs','/work:rw,nosuid,nodev,size=256m,mode=1777','node@'+imageDigest,'node','-e','setInterval(()=>{},1000)']);
   containerId=created.stdout.trim();
   if(!/^[a-f0-9]{64}$/.test(containerId)){containerId=undefined;throw Error('invalid container identity');}
   await requireOk(['start',containerId]);
   await requireOk(['exec',containerId,'cp','-R','/workspace/.','/work/']);
   const results=[];
   for(const c of commands){
    signal?.throwIfAborted();
    if(Date.now()>=deadline)throw Error('project deadline exceeded');
    const x=await call(['exec','--workdir','/work/'+c.cwd,containerId,...c.argv]);
    results.push({argv:c.argv,cwd:c.cwd,exitCode:x.code,stdout:x.stdout,stderr:x.stderr});
   }
   return {commands:results,runtime:'docker',imageDigest};
  }finally{
   // Creation without a returned ID is ambiguous: leave durable registration for reconciliation.
   if(containerId){
    const x=await call(['rm','-f',containerId],true);
    if(x.code!==0&&!x.stderr.includes('No such container'))throw Error('project cleanup failed');
    await store.transact(s=>api.markResourceCleaned(s,id,clock()));
   }
  }
 };
}
