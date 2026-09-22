import test from 'node:test';
import assert from 'node:assert/strict';
import {shouldReviveSoloBoss} from '../js/boss-respawn.js';
test('solo boss returns 60 seconds after defeat even if game was closed',()=>{
 assert.equal(shouldReviveSoloBoss({hp:0,respawnAt:61000},60999),false);
 assert.equal(shouldReviveSoloBoss({hp:0,respawnAt:61000},61000),true);
 assert.equal(shouldReviveSoloBoss({hp:1500,respawnAt:null},61000),false);
});
