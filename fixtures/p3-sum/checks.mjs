import test from 'node:test';
import assert from 'node:assert/strict';
import {sum} from './sum.mjs';
test('empty',()=>assert.equal(sum([]),0));
test('multiple',()=>assert.equal(sum([2,3,4]),9));
test('negative',()=>assert.equal(sum([-4,2]),-2));
