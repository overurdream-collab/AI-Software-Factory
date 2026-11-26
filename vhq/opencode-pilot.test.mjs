import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runPilot,verifyPilot} from './opencode-pilot.mjs';
const event=text=>JSON.stringify({type:'text',part:{text}});
test('generated addition passes five trusted cases',async()=>{const e=await runPilot(async()=>event('export function add(a,b){return a+b;}'));assert.equal(e.passed,5);assert.equal(e.sha256.length,64);});
test('reject arbitrary generated code and wrong arithmetic',()=>{for(const s of ['export function add(a,b){return a-b;}','export function add(a,b){return a+b;} process.exit(0);'])assert.throws(()=>verifyPilot(event(s)));});
test('reject tool events and malformed responses',()=>{assert.throws(()=>verifyPilot(JSON.stringify({type:'tool_use'})+'\n'+event('export function add(a,b){return a+b;}')));assert.throws(()=>verifyPilot('invalid'));});
test('provider failure is not acceptance',async()=>assert.rejects(runPilot(async()=>{throw Error('quota');})));

test('observed DeepSeek inline arrow function passes five cases',async()=>{const raw=[JSON.stringify({type:'step_start'}),event('`export const add = (a, b) => Number(a) + Number(b);`'),JSON.stringify({type:'step_finish',part:{cost:0}})].join('\n');const e=await runPilot(async()=>raw);assert.equal(e.passed,5);});
test('arrow grammar rejects side effects and extra expressions',()=>{for(const s of ['export const add = (a,b) => process.exit(0);','export const add = (a,b) => Number(a) + Number(b); console.log(1);','export const add = (a,b) => a-b;'])assert.throws(()=>verifyPilot(event(s)));});
