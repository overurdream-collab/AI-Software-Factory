import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,realpath,lstat,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
const exec=promisify(execFile);
export const oid=s=>typeof s==='string'&&/^[a-f0-9]{40}$/.test(s);
export function safePath(p){
 if(typeof p!=='string'||!p||p.length>512||p.split('/').some(s=>!s||s==='.'||s==='..'||s.toLowerCase()==='.git')||!/^[a-zA-Z0-9_./-]+$/.test(p)||p.startsWith('-')||/^(test|tests|__tests__|scripts|\.github|docs\/evidence)(\/|$)/i.test(p)||/\.(test|spec)\./i.test(p))throw Error('forbidden path');
 return p;
}
export async function git(cwd,args,signal){
 signal?.throwIfAborted();
 const {stdout}=await exec('git',['-c','core.hooksPath=/dev/null','-c','core.autocrlf=false','-c','core.fsmonitor=false',...args],{cwd,signal,timeout:30000,maxBuffer:4*1024*1024,env:{PATH:process.env.PATH,HOME:'/nonexistent',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_TERMINAL_PROMPT:'0',LC_ALL:'C'}});
 return stdout;
}
export async function sourceFile(workspace,path,signal){
 safePath(path); const entry=await git(workspace,['ls-files','--stage','--',path],signal);
 if(!/^100(?:644|755) [a-f0-9]{40} 0\t/.test(entry)||entry.trimEnd().split('\n').length!==1)throw Error('not a tracked regular file');
 let current=workspace;
 for(const part of path.split('/')){current=join(current,part);const st=await lstat(current);if(st.isSymbolicLink())throw Error('symlink');}
 if(!(await lstat(current)).isFile()||!(await realpath(current)).startsWith(workspace+sep))throw Error('outside workspace');
 return current;
}
export async function createWorkspace({root,repositoryPath,baseCommit,signal}){
 if(!oid(baseCommit))throw Error('invalid base commit');
 const parent=await realpath(root),repo=await realpath(repositoryPath);
 const workspace=await mkdtemp(join(parent,'worker-'));
 try{
  await git(workspace,['clone','--no-local','--no-checkout','--',repo,'.'],signal);
  await git(workspace,['checkout','--detach',baseCommit],signal);
  if((await git(workspace,['rev-parse','HEAD'],signal)).trim()!==baseCommit)throw Error('base mismatch');
  if(await git(workspace,['status','--porcelain'],signal))throw Error('dirty checkout');
  return {workspace,cleanup:()=>rm(workspace,{recursive:true,force:true})};
 }catch(e){await rm(workspace,{recursive:true,force:true});throw e;}
}
