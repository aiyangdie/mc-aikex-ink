import test from 'node:test';import assert from 'node:assert/strict';
import {mouseLookDelta} from '../js/mouse-look.js';
test('hover changes fallback view without button and first sample is not a jump',()=>{
 assert.equal(mouseLookDelta(null,{clientX:100,clientY:100}),null);
 assert.deepEqual(mouseLookDelta({x:100,y:100},{clientX:120,clientY:90}),{dx:20,dy:-10});
});
