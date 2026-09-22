/** Renderer-independent, single-player Boss combat. All timers use simulation time. */
export class BossCombat {
  constructor(hp = 1500) {
    this.maxHp = 1500;
    this.hp = Number.isFinite(hp) ? Math.max(0, Math.min(1500, hp)) : 1500;
    this.dead = this.hp === 0;
    this.state = this.dead ? 'dead' : 'idle';
    this.attackTime = 0;
    this.cooldown = 0;
    this.didHit = false;
  }

  takeDamage(amount) {
    if (this.dead || !Number.isFinite(amount) || amount <= 0) return;
    this.hp = Math.max(0, this.hp - amount);
    if (!this.hp) { this.dead = true; this.state = 'dead'; }
  }

  step(dt, target) {
    const result = { move: false, hit: 0, attackStarted: false };
    if (this.dead) return result;
    dt = Math.max(0, Math.min(dt, .05));
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (!target.playerAlive) { this.state = 'idle'; return result; }
    const inReach = target.visible && target.distance <= 2.15 && Math.abs(target.height) <= 1.4;
    if (this.state === 'attack') {
      this.attackTime += dt;
      if (!this.didHit && this.attackTime >= .35) {
        this.didHit = true;
        if (inReach && !target.invulnerable) result.hit = 5;
      }
      if (this.attackTime >= .8) this.state = 'idle';
      return result;
    }
    if (inReach && this.cooldown <= 0) {
      this.state = 'attack'; this.attackTime = 0; this.didHit = false; this.cooldown = 1.25;
      result.attackStarted = true;
    } else if (target.visible && target.distance > 1.7 && target.distance < 32) {
      this.state = 'run'; result.move = true;
    } else this.state = 'idle';
    return result;
  }
}
