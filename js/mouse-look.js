export function mouseLookDelta(previous,event){
 if(!previous||!Number.isFinite(event.clientX)||!Number.isFinite(event.clientY))return null;
 return {dx:event.clientX-previous.x,dy:event.clientY-previous.y};
}
