/** Wall-clock respawn survives a saved game and avoids repeated model creation. */
export function shouldReviveSoloBoss(state, now = Date.now()) {
  return !!state && state.hp === 0 && Number.isFinite(state.respawnAt) && now >= state.respawnAt;
}
/** Migrate pre-timer saves deterministically on first load. */
export function scheduleSoloRespawn(state,now=Date.now()){
 if(!state||state.hp!==0||Number.isFinite(state.respawnAt))return state;
 return {...state,respawnAt:now+60_000};
}
