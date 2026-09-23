export const isNukeCode=text=>text==='Maydaymayday';
export function sanitizeChat(text){
 if(typeof text!=='string'||!text.trim()||text.length>200||/[\u0000-\u001f\u007f]/.test(text))return null;
 return text.trim();
}
