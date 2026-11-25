import {runRound} from './parallel.mjs';
import {setTimeout as sleep} from 'node:timers/promises';

// Host owns adapter configuration. No implicit network or paid provider.
export async function runDaemon({store,workers,reconcile,signal,maxParallel=2,
 idleMs=1000,maxBackoffMs=30000,clock=Date.now,onProgress=()=>{}}){
 if(typeof reconcile!=='function'||typeof onProgress!=='function'||!signal||
 !Number.isSafeInteger(idleMs)||idleMs<1||!Number.isSafeInteger(maxBackoffMs)||maxBackoffMs<idleMs)throw Error('invalid daemon configuration');
 let delay=idleMs, rounds=0;
 while(!signal.aborted){
  let results;
  try{
   await reconcile();
   if(signal.aborted)break;
   results=await runRound({store,workers,maxParallel,signal});
   const errors=results.some(x=>x.state==='error'||x.state==='execution-error');
   delay=errors?Math.min(maxBackoffMs,delay*2):idleMs;
  }catch{
   delay=Math.min(maxBackoffMs,delay*2);
   results=[{state:'error'}];
  }
  await onProgress({round:++rounds,at:clock(),states:results.map(x=>x.state),delay});
  try{await sleep(delay,undefined,{signal});}catch(e){if(!signal.aborted)throw e;}
 }
 return {rounds,stopped:true};
}
