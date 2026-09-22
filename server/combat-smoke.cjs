// Run `npm run dev` first. This creates one temporary local room.
const WS = require('ws');
const assert = require('node:assert/strict');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function client() {
  const ws = new WS('ws://127.0.0.1:3040/ws');
  const messages = [];
  ws.on('message', raw => messages.push(JSON.parse(raw)));
  await new Promise((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
  return {
    ws, send: msg => ws.send(JSON.stringify(msg)),
    async wait(predicate) {
      for (let i = 0; i < 100; i++) {
        const at = messages.findIndex(predicate);
        if (at >= 0) return messages.splice(at, 1)[0];
        await delay(50);
      }
      throw new Error('WebSocket message timed out');
    },
  };
}
async function run() {
  const a = await client();
  let b;
  try {
    b = await client();
    a.send({ t: 'create', name: 'AK test A' });
    const first = await a.wait(m => m.t === 'joined');
    b.send({ t: 'join', room: first.room, name: 'AK test B' });
    const second = await b.wait(m => m.t === 'joined');
    assert.equal(first.self.hp, 20); assert.equal(second.players[0].hp, 20);
    a.send({ t: 'move', x: 0, y: 20, z: 0, yaw: 0, pitch: 0, dimension: 'overworld' });
    b.send({ t: 'move', x: 0, y: 20, z: -10, yaw: 0, pitch: 0, dimension: 'overworld' });
    await delay(100);
    for (let n = 0; n < 4; n++) {
      a.send({ t: 'shoot', direction: [0, 0, -1], distance: 80 });
      const hit = await b.wait(m => m.t === 'combat' && m.id === second.id);
      assert.equal(hit.hp, 15 - n * 5);
      await delay(140);
    }
    b.send({ t: 'move', x: 99, y: 99, z: 99, yaw: 0, pitch: 0 });
    b.send({ t: 'shoot', direction: [0, 0, 1], distance: 80 });
    b.send({ t: 'sync' });
    const snapshot = await b.wait(m => m.t === 'sync');
    assert.equal(snapshot.self.hp, 0); assert.equal(snapshot.self.x, 0);
    assert.equal(snapshot.players[0].hp, 20);
    const reborn = await b.wait(m => m.t === 'combat' && m.respawn);
    assert.equal(reborn.hp, 20); assert.equal(reborn.y, 19.2);
    a.send({ t: 'move', x: reborn.x, y: reborn.y, z: reborn.z + 10, yaw: 0, pitch: 0, dimension: 'overworld' });
    await delay(80);
    a.send({ t: 'shoot', direction: [0, 0, -1], distance: 80 });
    await delay(100);
    b.send({ t: 'sync' });
    assert.equal((await b.wait(m => m.t === 'sync')).self.hp, 20);
    console.log('PASS: two clients, damage, death, dead action rejection, snapshot, respawn, protection');
  } finally { a.ws.close(); b?.ws.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
