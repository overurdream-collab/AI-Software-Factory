import {createHash} from 'node:crypto';
import {writeFile,readFile,mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
// A narrow, non-executing adapter for a single trusted fixture.
// Model output is data, never a command, path, or executable test.
export const digest = value => createHash('sha256').update(value).digest('hex');
export async function propose({source,goal,generate}){
 if(typeof source!=='string'||typeof goal!=='string'||typeof generate!=='function')throw Error('invalid input');
 const candidate=await generate({source,goal});
 if(typeof candidate!=='string'||!candidate.trim()||Buffer.byteLength(candidate)>65536)throw Error('invalid candidate');
 return JSON.stringify({version:1,base:digest(source),candidate,sha:digest(candidate)});
}
export async function verifyPatch({source,artifact,check}){
 const p=JSON.parse(artifact);
 if(p.version!==1||p.base!==digest(source)||typeof p.candidate!=='string'||Buffer.byteLength(p.candidate)>65536||p.sha!==digest(p.candidate))throw Error('invalid patch evidence');
 const dir=await mkdtemp(join(tmpdir(),'factory-patch-'));
 try{
  const file=join(dir,'candidate.txt');
  await writeFile(file,p.candidate,{flag:'wx',mode:0o600});
  const observed=await readFile(file,'utf8');
  const passed=await check(observed);
  if(typeof passed!=='boolean')throw Error('invalid check verdict');
  return {passed,evidence:JSON.stringify({sha:digest(observed),passed,check:'trusted-fixture'})};
 }finally{await rm(dir,{recursive:true,force:true});}
}
