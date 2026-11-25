import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clamp} from './clamp.mjs';

// F owns these checks. They are never included in the model prompt.
test('keeps an interior positive value',()=>assert.equal(clamp(4,1,8),4));
test('caps values above the upper bound',()=>assert.equal(clamp(19,1,8),8));
test('raises values below the lower bound',()=>assert.equal(clamp(-9,1,8),1));
test('preserves both exact boundaries',()=>{assert.equal(clamp(1,1,8),1);assert.equal(clamp(8,1,8),8);});
test('handles an entirely negative interval',()=>{assert.equal(clamp(-20,-7,-2),-7);assert.equal(clamp(0,-7,-2),-2);assert.equal(clamp(-4,-7,-2),-4);});
test('supports fractional values and bounds',()=>{assert.equal(clamp(-0.75,-0.5,1.25),-0.5);assert.equal(clamp(0.125,-0.5,1.25),0.125);assert.equal(clamp(1.5,-0.5,1.25),1.25);});
test('collapses equal bounds for low interior and high inputs',()=>{for(const value of [-10,3,11])assert.equal(clamp(value,3,3),3);});
