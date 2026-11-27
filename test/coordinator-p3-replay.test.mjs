import test from 'node:test';
import assert from 'node:assert/strict';
import {validate,BASE} from '../scripts/coordinator-p3-replay.mjs';
test('rejects wrong pinned base',()=>assert.throws(()=>validate({baseCommit:'wrong'})));
test('rejects missing artifacts',()=>assert.throws(()=>validate({baseCommit:BASE,imageDigest:'sha256:'+'a'.repeat(64),staleRejected:true,tasks:[]})));
test('rejects duplicate task ids',()=>assert.throws(()=>validate({baseCommit:BASE,imageDigest:'sha256:'+'a'.repeat(64),staleRejected:true,tasks:[{id:'sum'},{id:'sum'}]})));
