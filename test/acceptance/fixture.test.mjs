import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const suite = `import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp } from './candidate.mjs';
test('lower bound',()=>assert.equal(clamp(-8,2,10),2));
test('upper bound',()=>assert.equal(clamp(19,2,10),10));
test('interior',()=>assert.equal(clamp(7,2,10),7));
test('negative interval',()=>assert.equal(clamp(-20,-9,-3),-9));
test('equal bounds',()=>assert.equal(clamp(100,4,4),4));
test('fractional value',()=>assert.equal(clamp(0.25,-1,1),0.25));
test('varied values',()=>{for(let i=-40;i<=40;i++) assert.equal(clamp(i,-13,17),Math.min(17,Math.max(-13,i)));});
`;
function run(source) {
  const dir=mkdtempSync(join(tmpdir(),'factory-f-'));
  try {
    writeFileSync(join(dir,'candidate.mjs'),source);
    writeFileSync(join(dir,'independent.test.mjs'),suite);
    const result=spawnSync(process.execPath,['--test','independent.test.mjs'],{cwd:dir,encoding:'utf8',timeout:10000});
    assert.ifError(result.error);
    assert.equal(result.signal,null);
    assert.match(result.stdout,/# tests 7\b/);
    assert.match(result.stdout,/# skipped 0\b/);
    return result;
  } finally {rmSync(dir,{recursive:true,force:true});}
}
test('known defective fixture is red',()=>assert.equal(run('export const clamp=(v,lo,hi)=>Math.min(hi,v);').status,1));
test('known correct control is green',()=>assert.equal(run('export const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));').status,0));
test('constant-answer mutant is rejected',()=>assert.equal(run('export const clamp=()=>2;').status,1));
test('disabled-test mutant is rejected',()=>assert.throws(()=>run('process.exit(0); export const clamp=()=>2;')));
