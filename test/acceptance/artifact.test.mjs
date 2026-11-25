import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const digest = s => createHash('sha256').update(s,'utf8').digest('hex');
function git(dir,...args) {
  return execFileSync('git',args,{cwd:dir,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trimEnd();
}
function fixture(fn) {
  const dir=mkdtempSync(join(tmpdir(),'factory-f-artifact-'));
  try {
    git(dir,'init','-q');
    writeFileSync(join(dir,'source.mjs'),'export const answer = 0;\n');
    git(dir,'add','source.mjs');
    git(dir,'-c','user.name=Acceptance','-c','user.email=acceptance@example.invalid','commit','-qm','base');
    const baseCommit=git(dir,'rev-parse','HEAD');
    writeFileSync(join(dir,'source.mjs'),'export const answer = 42;\n');
    const patch=execFileSync('git',['diff','--','source.mjs'],{cwd:dir,encoding:'utf8'});
    git(dir,'add','source.mjs');
    const candidateTree=git(dir,'write-tree');
    git(dir,'reset','--hard',baseCommit);
    fn(dir,{baseCommit,patch,patchSha256:digest(patch),candidateTree,changedPaths:['source.mjs']});
  } finally {rmSync(dir,{recursive:true,force:true});}
}
function verifyControl(dir,a) {
  assert.equal(git(dir,'status','--porcelain'),'');
  assert.equal(git(dir,'rev-parse','HEAD'),a.baseCommit);
  assert.equal(digest(a.patch),a.patchSha256);
  assert.deepEqual(a.changedPaths,['source.mjs']);
  writeFileSync(join(dir,'.git','acceptance.patch'),a.patch);
  git(dir,'apply','--check','--index','.git/acceptance.patch');
  git(dir,'apply','--index','.git/acceptance.patch');
  assert.deepEqual(git(dir,'diff','--cached','--name-only').split('\n'),a.changedPaths);
  assert.equal(git(dir,'diff','--cached','--name-status'),'M\tsource.mjs');
  assert.match(git(dir,'ls-files','--stage','source.mjs'),/^100644 /);
  assert.equal(git(dir,'write-tree'),a.candidateTree);
}
test('reference patch matches clean base, digest, paths and tree',()=>fixture(verifyControl));
test('tampered patch digest rejected',()=>fixture((d,a)=>assert.throws(()=>verifyControl(d,{...a,patch:a.patch+'\n'}))));
test('wrong base rejected',()=>fixture((d,a)=>assert.throws(()=>verifyControl(d,{...a,baseCommit:'0'.repeat(40)}))));
test('wrong tree rejected',()=>fixture((d,a)=>assert.throws(()=>verifyControl(d,{...a,candidateTree:'0'.repeat(40)}))));
test('wrong declared path rejected',()=>fixture((d,a)=>assert.throws(()=>verifyControl(d,{...a,changedPaths:['test/acceptance/fixture.test.mjs']}))));
test('dirty workspace rejected',()=>fixture((d,a)=>{writeFileSync(join(d,'source.mjs'),'dirty');assert.throws(()=>verifyControl(d,a));}));
