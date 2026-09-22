import test from 'node:test';
import assert from 'node:assert/strict';
import {NetClient} from '../js/net.js';
test('network client delivers authoritative Boss/health/respawn messages',()=>{
 const c=new NetClient(),received=[];
 for(const t of ['boss','vitals','respawned'])c.on(t,m=>received.push(m.t));
 for(const t of ['boss','vitals','respawned'])c._onMsg({t,hp:15});
 assert.deepEqual(received,['boss','vitals','respawned']);
});
