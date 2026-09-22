import test from 'node:test';
import assert from 'node:assert/strict';
import {SaveManager} from '../js/save.js';
const entries=new Map();
globalThis.localStorage={getItem:k=>entries.get(k)||null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};
test('save preserves Boss damage and defeat across reload',()=>{
  for(const hp of [1275,0]) {
    SaveManager.save({seed:1,player:{x:0,y:19,z:0,yaw:0,pitch:0},edits:[],mistBoss:{hp,x:8,y:19,z:0}});
    assert.deepEqual(SaveManager.load().mistBoss,{hp,x:8,y:19,z:0});
  }
});
