import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
export const model='opencode/deepseek-v4.1-flash-free';
// Fixed synthetic prompt only. No user text, project files, credentials or shell interpolation.
const command="set -eu; d=$(mktemp -d); trap 'rm -rf -- \"$d\"' EXIT; cd \"$d\"; export OPENCODE_CONFIG_CONTENT='{\"permission\":{\"*\":\"deny\"}}'; timeout --kill-after=10s 280s opencode run --model opencode/deepseek-v4.1-flash-free --format json 'Write one JavaScript line exporting a function named add with parameters a and b that returns their numeric sum. No explanation. Do not use tools or access files.'";
export function invokeFreePilot({spawnImpl=spawn,timeoutMs=300000,onProgress=()=>{}}={}){
 return new Promise((resolve,reject)=>{
  const p=spawnImpl('wsl.exe',['-d','Ubuntu-24.04','-e','bash','-ic',command],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
  let out='',size=0,done=false; const started=Date.now(); const report=()=>{try{onProgress({elapsedMs:Date.now()-started,receivedBytes:size});}catch{}}; const heartbeat=setInterval(report,5000);
  const finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);clearInterval(heartbeat);report();err?reject(err):resolve(value);};
  const timer=setTimeout(()=>{p.kill();finish(Error('timeout-ambiguous'));},timeoutMs);
  for(const [stream,isOut] of [[p.stdout,true],[p.stderr,false]])stream.on('data',c=>{size+=c.length;if(size>65536){p.kill();finish(Error('output-limit-ambiguous'));}else if(isOut)out+=c.toString();report();});
  p.on('error',()=>finish(Error('launch-failed')));
  p.on('close',code=>{if(code===124||code===137)return finish(Error('timeout-ambiguous'));if(code!==0)return finish(Error('provider-failed'));finish(null,out);});
 });
}
export function verifyPilot(raw){
 // Strict grammar: never execute unrestricted model code. Parse only text events.
 if(typeof raw!=='string'||Buffer.byteLength(raw)>65536)throw Error('invalid output');
 const texts=[];
 for(const line of raw.split(/\r?\n/)){if(!line.trim())continue;let e;try{e=JSON.parse(line);}catch{throw Error('invalid provider event');}if(e.type==='error')throw Error('provider error');if(e.type==='text'&&typeof e.part?.text==='string')texts.push(e.part.text);if(e.type==='tool_use')throw Error('unexpected tool use');}
 const code=texts.join('').trim().replace(/^`([^`\r\n]+)`$/,'$1').replace(/^```(?:javascript|js)?\s*\n([\s\S]*?)\n```$/,'$1').trim();
 const functionForm=/^export\s+function\s+add\s*\(\s*a\s*,\s*b\s*\)\s*\{\s*return\s+a\s*\+\s*b\s*;?\s*\}$/;
 const arrowForm=/^export\s+const\s+add\s*=\s*\(\s*a\s*,\s*b\s*\)\s*=>\s*(?:a\s*\+\s*b|Number\(\s*a\s*\)\s*\+\s*Number\(\s*b\s*\))\s*;?$/;
 if(!functionForm.test(code)&&!arrowForm.test(code))throw Error('candidate outside allowed grammar');
 return {model,code,sha256:createHash('sha256').update(code).digest('hex'),verification:'strict-addition-grammar',tests:0};
}
export async function runPilot(invoke=invokeFreePilot){
 const evidence=verifyPilot(await invoke());
 // Only after strict grammar validation, import the constrained generated module.
 const {add}=await import('data:text/javascript;base64,'+Buffer.from(evidence.code).toString('base64'));
 const cases=[[2,3,5],[-4,1,-3],[0,0,0],[1.5,2.25,3.75],[-2,-3,-5]];
 for(const [a,b,want] of cases)if(add(a,b)!==want)throw Error('acceptance failed');
 return {...evidence,tests:cases.length,passed:cases.length};
}
