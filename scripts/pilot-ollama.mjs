import {ollamaGenerator} from '../src/ollama.mjs';
import {propose,verifyPatch} from '../src/patch-adapter.mjs';
import {tick} from '../src/worker-loop.mjs';
import {DurableStore} from '../src/durable-store.mjs';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const source='export const port = 0;';
const goal='Change port to 8080. Return the entire line exactly as export const port = 8080;';
const dir=await mkdtemp(join(tmpdir(),'factory-live-'));
try{
 const store=new DurableStore(join(dir,'state.json'));
 await store.transact(s=>s.tasks.push({id:'pilot',role:'dev',goal,state:'queued',attempts:0}));
 const generate=ollamaGenerator({model:process.env.OLLAMA_MODEL||'qwen3:8b'});
 for(let i=0;i<3;i++){
  const result=await tick({store,role:'dev',worker:'local-model',reviewer:'trusted-fixture',ttl:180000,execute:()=>propose({source,goal,generate}),verify:t=>verifyPatch({source,artifact:t.artifact,check:c=>c.trim()==='export const port = 8080;'})});
  if(result.state==='accepted'){console.log(JSON.stringify(await store.transact(s=>s.tasks.map(({id,state,attempts,evidence})=>({id,state,attempts,evidence})))));process.exitCode=0;break;}
  if(result.state!=='queued'||i===2){console.error('pilot not accepted:',result.state);process.exitCode=1;break;}
 }
}finally{await rm(dir,{recursive:true,force:true});}
