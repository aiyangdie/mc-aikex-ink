export function nextHost(peers){return peers.values().next().value?.id||null;}
export function resetRoomTerrain(room,peer){
 if(!peer||!room||peer.id!==room.hostId||![...room.peers?.values?.()||[peer]].includes(peer))return false;
 room.terrain.clearAll();room.terrainRevision++;room.touch();return true;
}
