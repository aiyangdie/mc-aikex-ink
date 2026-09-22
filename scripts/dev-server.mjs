/** Loopback-only static dev server. Optional /api and /ws proxy to local backend. */
import http from 'node:http';
import net from 'node:net';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url));
const port=Number(process.env.PORT||8086);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.glb':'model/gltf-binary','.png':'image/png','.json':'application/json'};
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname.startsWith('/api/')){
    const proxy=http.request({hostname:'127.0.0.1',port:3040,path:req.url,method:req.method,headers:req.headers},up=>{res.writeHead(up.statusCode,up.headers);up.pipe(res);});
    proxy.on('error',()=>{res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'本地联机服务未启动'}));});
    req.pipe(proxy);return;
  }
  try{
    const relative=decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html';
    const file=path.resolve(root,relative);
    const parts=relative.split('/');
    if(!file.startsWith(root)||parts.some(p=>p.startsWith('.'))||['server','node_modules'].includes(parts[0])){
      res.writeHead(403);res.end('Forbidden');return;
    }
    const bytes=await readFile(file);
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(bytes);
  }catch{res.writeHead(404);res.end('Not found');}
});
server.on('upgrade',(req,socket,head)=>{
  if(new URL(req.url,'http://localhost').pathname!=='/ws'){socket.destroy();return;}
  const upstream=net.connect(3040,'127.0.0.1',()=>{
    upstream.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`+Object.entries(req.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')+'\r\n\r\n');
    if(head.length)upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
});
server.listen(port,'127.0.0.1',()=>console.log(`游戏预览：http://127.0.0.1:${port}`));
