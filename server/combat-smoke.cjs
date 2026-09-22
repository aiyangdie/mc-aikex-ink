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
    assert.equal(reborn.hp, 20); assert.ok([reborn.x, reborn.y, reborn.z].every(Number.isFinite));
    b.send({ t: 'move', x: 5.4, y: 50, z: 22.6, yaw: 0, pitch: 0, dimension: 'overworld' });
    a.send({ t: 'move', x: 5.4, y: 50, z: 32.6, yaw: 0, pitch: 0, dimension: 'overworld' });

    await delay(80);
    a.send({ t: 'shoot', direction: [0, 0, -1], distance: 80 });
    await delay(100);
    b.send({ t: 'sync' });
    assert.equal((await b.wait(m => m.t === 'sync')).self.hp, 20);
    await delay(2100);
    b.send({ t: 'move', x: 5.4, y: 50, z: 27.6, yaw: 0, pitch: 0, dimension: 'overworld' });
    a.send({ t: 'mode', mode: 'mage' });
    a.send({ t: 'fireball', end: [5.4, 50.1, 27.6], ground: [5.4, 50.02, 27.6] });
    const ball = await b.wait(m => m.t === 'fireball');
    const fire = await b.wait(m => m.t === 'fire');
    assert.equal(fire.expires - ball.impact, 5000);
    assert.equal((await b.wait(m => m.t === 'combat' && m.id === second.id)).hp, 14);
    assert.equal((await b.wait(m => m.t === 'combat' && m.id === second.id)).hp, 12);
    b.send({ t: 'move', x: 20, y: 50, z: 27.6, yaw: 0, pitch: 0 });
    a.send({ t: 'sync' });
    assert.equal((await a.wait(m => m.t === 'sync')).spells.fires.length, 1);
    a.send({ t: 'blink', to: [5.4, 50, 40.6] });
    assert.equal((await a.wait(m => m.t === 'combat' && m.teleport)).z, 40.6);
    a.send({ t: 'blink', to: [5.4, 50, 32.6] });
    a.send({ t: 'sync' });
    assert.equal((await a.wait(m => m.t === 'sync')).self.z, 40.6);
    await delay(Math.max(0, fire.expires - Date.now()) + 250);
    a.send({ t: 'sync' });
    assert.equal((await a.wait(m => m.t === 'sync')).spells.fires.length, 0);
    console.log('PASS: AK damage/death/respawn, mage fireball/burning/5s expiry/snapshot, blink/cooldown');
  } finally { a.ws.close(); b?.ws.close(); }
}
run().catch(error => { console.error(error); process.exitCode = 1; });
