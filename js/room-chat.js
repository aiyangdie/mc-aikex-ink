/** Safe text-only room chat HUD; no HTML from the network is ever interpreted. */
export class RoomChat {
  constructor({onSend,onReset}){
    this.root=document.getElementById('roomChat');
    this.log=document.getElementById('roomChatLog');
    this.input=document.getElementById('roomChatInput');
    this.form=document.getElementById('roomChatForm');
    this.reset=document.getElementById('btnTerrainReset');
    this.onSend=onSend;this.onReset=onReset;
    this.form.addEventListener('submit',event=>{event.preventDefault();const value=this.input.value;
      if(value.trim())this.onSend(value);this.input.value='';this.close();});
    this.reset.addEventListener('click',()=>onReset());
  }
  get open(){return !this.form.hidden;}
  show(){this.root.hidden=false;}
  hide(){this.root.hidden=true;this.close();}
  focus(){this.form.hidden=false;this.input.focus();}
  close(){this.form.hidden=true;this.input.blur();}
  append(name,text){
    const row=document.createElement('div');row.className='room-chat-line';
    row.textContent=String(name||'玩家')+': '+String(text||'');
    this.log.appendChild(row);this.log.scrollTop=this.log.scrollHeight;
    while(this.log.children.length>40)this.log.firstChild.remove();
  }
  host(isHost){this.reset.hidden=!isHost;}
}
