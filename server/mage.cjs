'use strict';
const combat = require('./combat.cjs');
const vector = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const distance = (a, b) => Math.hypot(...a.map((n, i) => n - b[i]));
class Spells {
  constructor() { this.projectiles = []; this.fires = []; this.sequence = 0; }
  cast(p, msg, now) {
    if (p.hp <= 0 || p.mode !== 'mage' || now < (p.nextFireball || 0)) return null;
    const origin = [p.x, p.y + 1.6, p.z];
    if (!vector(msg.end) || distance(origin, msg.end) > 42) return null;
    if (msg.ground != null && (!vector(msg.ground) ||
      Math.hypot(msg.ground[0] - msg.end[0], msg.ground[2] - msg.end[2]) > .5 ||
      msg.ground[1] > msg.end[1] + .2 || msg.end[1] - msg.ground[1] > 48)) return null;
    p.nextFireball = now + 900;
    const ball = { t: 'fireball', id: ++this.sequence, by: p.id, dimension: p.dimension,
      origin, end: msg.end, ground: msg.ground || null, start: now,
      impact: now + Math.max(80, distance(origin, msg.end) / 22 * 1000) };
    this.projectiles.push(ball);
    return ball;
  }
  blink(p, msg, now) {
    if (p.hp <= 0 || p.mode !== 'mage' || now < (p.nextBlink || 0) || !vector(msg.to)) return false;
    if (distance([p.x, p.y, p.z], msg.to) > 8.5) return false;
    p.nextBlink = now + 5000;
    [p.x, p.y, p.z] = msg.to;
    return true;
  }
  snapshot(now) { return { projectiles: this.projectiles.filter(b => b.impact > now), fires: this.fires.filter(f => f.expires > now) }; }
  tick(peers, now, emit) {
    const players = [...peers];
    const damage = (effect, amount) => {
      for (const p of players) {
        if (p.id === effect.by || p.dimension !== effect.dimension || p.hp <= 0) continue;
        const [x,y,z] = effect.position;
        if (Math.hypot(p.x-x, p.z-z) > 2.5 || p.y > y+2 || p.y+1.75 < y) continue;
        if (combat.hurt(p, amount, now)) emit({ t: 'combat', ...combat.state(p), by: effect.by });
      }
    };
    for (const ball of this.projectiles) {
      if (now < ball.impact || !ball.ground) continue;
      const fire = { t: 'fire', id: ball.id, by: ball.by, dimension: ball.dimension,
        position: ball.ground, expires: ball.impact + 5000, nextDamage: now + 500 };
      if (now >= fire.expires) continue;
      this.fires.push(fire); emit(fire); damage(fire, 6);
    }
    this.projectiles = this.projectiles.filter(b => now < b.impact);
    this.fires = this.fires.filter(f => now < f.expires);
    for (const fire of this.fires) {
      if (now < fire.nextDamage) continue;
      fire.nextDamage = now + 500; damage(fire, 2);
    }
  }
}
module.exports = { Spells };
