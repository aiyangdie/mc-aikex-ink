/** Wall-clock respawn survives a saved game and avoids repeated model creation. */
export function shouldReviveSoloBoss(state, now = Date.now()) {
  return !!state && state.hp === 0 && Number.isFinite(state.respawnAt) && now >= state.respawnAt;
}
