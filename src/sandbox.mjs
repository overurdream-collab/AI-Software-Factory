import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {digest} from './patch-adapter.mjs';

// Fixed runtime and command; generated source is stdin only.
// Docker must be operated on a trusted, dedicated host, not a production host.
// This is a constrained pilot, not a complete hostile-code isolation guarantee.
function invoke(args,input,timeoutMs,signal){
 signal?.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const p=spawn('docker',args,{stdio:['pipe','pipe','pipe'],windowsHide:true});
  let stdout='',stderr='',failure=null;
  const abort=()=>{failure=signal.reason??Error('sandbox aborted');p.kill('SIGKILL');};
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  const timer=setTimeout(()=>{failure=Error('sandbox timeout');p.kill('SIGKILL');},timeoutMs);
  const append=(old,chunk)=>{const next=old+chunk.toString('utf8');if(Buffer.byteLength(next)>65536){failure=Error('sandbox output limit');p.kill('SIGKILL');return old;}return next;};
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
