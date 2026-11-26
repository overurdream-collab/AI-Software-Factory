import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runOpenRouterPilot} from './openrouter-pilot.mjs';
const model='org/model:free';
function mock({cost=0,returnedModel=model,content='export function add(a,b){return a+b;}',freeTier=true}={}){
 const calls=[];
 const fetchImpl=async(url,opts)=>{
 calls.push({url,opts});
 const body=url.endsWith('/key')?{data:{is_free_tier:freeTier}}:url.endsWith('/models')?{data:[{id:model,pricing:{prompt:'0',completion:'0'}}]}:{id:'gen-test',model:returnedModel,choices:[{finish_reason:'stop',message:{role:'assistant',content}}],usage:{cost}};
 return new Response(JSON.stringify(body));
 };
 return {calls,opts:{env:{OPENROUTER_API_KEY:'fake'},fetchImpl}};
}
test('free pilot verifies five cases and zero cost',async()=>{const m=mock();const e=await runOpenRouterPilot(model,m.opts);assert.equal(e.passed,5);assert.equal(e.cost,0);assert.equal(e.model,model);assert.equal(m.calls.length,3);const b=JSON.parse(m.calls[2].opts.body);assert.equal(b.model,model);assert.equal(b.provider.allow_fallbacks,false);assert.ok(Object.values(b.provider.max_price).every(v=>v===0));assert.equal(b.tools,undefined);});
test('paid model rejected before network',async()=>{const m=mock();await assert.rejects(runOpenRouterPilot('org/paid',m.opts),/free-model-required/);assert.equal(m.calls.length,0);});
test('non-free account rejected before generation',async()=>{const m=mock({freeTier:false});await assert.rejects(runOpenRouterPilot(model,m.opts),/free-account-or-model-unverified/);assert.equal(m.calls.length,2);});
test('nonzero cost rejected',async()=>{await assert.rejects(runOpenRouterPilot(model,mock({cost:0.01}).opts),/router-cost-unverified/);});
test('different model rejected',async()=>{await assert.rejects(runOpenRouterPilot(model,mock({returnedModel:'org/other'}).opts),/router-response-unverified/);});
test('unrestricted code rejected before execution',async()=>{await assert.rejects(runOpenRouterPilot(model,mock({content:'export function add(a,b){throw Error("unsafe");}'}).opts),/candidate outside allowed grammar/);});
