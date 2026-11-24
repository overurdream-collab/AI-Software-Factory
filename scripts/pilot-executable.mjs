import {SQLiteStore} from '../src/sqlite-store.mjs';
import {runRound} from '../src/parallel.mjs';
import {ollamaGenerator} from '../src/ollama.mjs';
import {propose} from '../src/patch-adapter.mjs';
import {verifyExecutable} from '../src/sandbox.mjs';
import {resolve} from 'node:path';
const store=new SQLiteStore(resolve(process.argv[2]||'factory-pilot.db'));
const fixtures={a:{source:'console.log(0)',goal:'Print exactly 4 using arithmetic.',expected:'4'},b:{source:'console.log(0)',goal:'Print exactly 9 using arithmetic.',expected:'9'}};
try{
 await store.transact(s=>{if(!s.tasks.length)for(const id of Object.keys(fixtures))s.tasks.push({id,role:'dev',state:'queued',attempts:0});});
 const generate=ollamaGenerator({model:process.env.OLLAMA_MODEL||'qwen3:8b'});
 const workers=['one','two'].map(id=>({role:'dev',worker:id,reviewer:'verify-'+id,ttl:180000,execute:t=>propose({...fixtures[t.id],generate}),verify:t=>verifyExecutable({...fixtures[t.id],artifact:t.artifact})}));
 for(let i=0;i<6;i++){
  const result=await runRound({store,workers,maxParallel:2});
  console.log(JSON.stringify(result));
  if(result.every(r=>r.state==='idle'))break;
 }
 const state=await store.transact(s=>s.tasks.map(({id,state,attempts,evidence})=>({id,state,attempts,evidence})));
 console.log(JSON.stringify(state));process.exitCode=state.every(t=>t.state==='accepted')?0:1;
}finally{store.close();}
