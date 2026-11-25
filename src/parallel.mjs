import {tick} from './worker-loop.mjs';
export async function runRound({store,workers,maxParallel=2,signal}){
 if(!Array.isArray(workers)||!Number.isInteger(maxParallel)||maxParallel<1||maxParallel>8)throw Error('invalid concurrency');
 const ids=new Set();
 for(const w of workers){if(!w.worker||!w.reviewer||w.worker===w.reviewer||ids.has(w.worker))throw Error('invalid worker identity');ids.add(w.worker);}
 if(workers.some(w=>ids.has(w.reviewer)))throw Error('reviewer cannot be a worker');
 let index=0;const results=[];
 async function lane(){
  while(!signal?.aborted&&index<workers.length){
   const i=index++;const w=workers[i];
   try{results[i]=await tick({...w,store,signal});}catch{results[i]={state:'error',worker:w.worker};}
  }
 }
 await Promise.all(Array.from({length:Math.min(maxParallel,workers.length)},lane));
 return results.filter(Boolean);
}
