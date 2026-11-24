import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ollamaGenerator} from '../src/ollama.mjs';
test('local endpoint, bounded request and structured candidate',async()=>{
 const generate=ollamaGenerator({fetchImpl:async(url,options)=>{
  assert.equal(url,'http://127.0.0.1:11434/api/generate');
  assert.equal(options.redirect,'error');
  assert.equal(JSON.parse(options.body).stream,false);
  assert.equal(JSON.parse(options.body).model,'qwen3:8b');
  return new Response(JSON.stringify({done:true,response:JSON.stringify({candidate:'fixed'})}));
 }});
 assert.equal(await generate({source:'old',goal:'fix'}),'fixed');
});
test('reject invalid response and configuration',async()=>{
 assert.throws(()=>ollamaGenerator({port:0}));
 const generate=ollamaGenerator({fetchImpl:async()=>new Response(JSON.stringify({done:false,response:'{}'}))});
 await assert.rejects(generate({source:'old',goal:'fix'}));
 const failure=ollamaGenerator({fetchImpl:async()=>new Response('',{status:503})});
 await assert.rejects(failure({source:'old',goal:'fix'}));
});

test('caller cancellation reaches local fetch and pre-abort avoids request',async()=>{
 const controller=new AbortController();let calls=0;
 const generate=ollamaGenerator({fetchImpl:async(_url,{signal})=>{calls++;return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}});
 const pending=generate({source:'old',goal:'fix',signal:controller.signal});
 controller.abort(new Error('lease lost'));
 await assert.rejects(pending,/lease lost/);
 await assert.rejects(generate({source:'old',goal:'fix',signal:controller.signal}),/lease lost/);
 assert.equal(calls,1);
});
