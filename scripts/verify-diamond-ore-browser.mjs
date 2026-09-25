/** Local-only browser evidence for naturally generated ore and microtext. */
import assert from 'node:assert/strict';
import http from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const server=http.createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.includes('..')){res.writeHead(400).end();return;}
  try{
    let body=await readFile(new URL('../'+(path==='/'?'index.html':path.slice(1)),import.meta.url));
    if(path==='/js/game.js')body=body.toString().replace('const game = new Game();','const game = new Game(); window.__oreGame=game;');
    res.setHeader('Content-Type',path.endsWith('.js')?'text/javascript':path.endsWith('.css')?'text/css':path.endsWith('.glb')?'model/gltf-binary':'text/html');
    res.end(body);
  }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let browser;
try{
  browser=await chromium.launch({headless:process.env.MC_BROWSER_HEADLESS!=='0',args:['--enable-unsafe-swiftshader']});
  const page=await browser.newPage({viewport:{width:1200,height:800},deviceScaleFactor:1});
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.waitForFunction(()=>window.__oreGame?.world?.adMaterial && document.getElementById('loadingBar').style.display==='none');
  const result=await page.evaluate(async()=>{
    const {hasDiamondMicrotext}=await import('/js/ad-decals.js');
    const {BlockType}=await import('/js/voxel.js');
    const g=window.__oreGame,w=g.world;
    const chunk=g._createChunk(4,7);
    for(let y=1;y<40;y++)for(let z=0;z<16;z++)for(let x=0;x<16;x++){
      if(chunk.getBlock(x,y,z)!==BlockType.DIAMOND_ORE)continue;
      const wx=4*16+x,wz=7*16+z;
      if(!hasDiamondMicrotext(w.seed,'overworld',wx,y,wz))continue;
      // Dig open one generated ore with the existing block-edit path.
      for(let dy=1;dy<=3;dy++)w.setBlock(wx,y+dy,wz,BlockType.AIR);
      for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)
        if(dx||dz)for(let dy=0;dy<=3;dy++)w.setBlock(wx+dx,y+dy,wz+dz,BlockType.AIR);
      chunk.buildMesh((X,Y,Z)=>w.getBlock(X,Y,Z),w.material,w.waterMaterial);
      if(chunk.mesh&&!chunk.mesh.parent)g.scene.add(chunk.mesh);
      if(chunk.adMesh&&!chunk.adMesh.parent)g.scene.add(chunk.adMesh);
      const actual=chunk.adEntries.find(a=>a.x===wx&&a.y===y&&a.z===wz);
      if(!actual)continue;
      g.camera.position.set(wx+.5,y+2.6,wz+1.3);
      g.camera.lookAt(wx+.5,y+1,wz+.5);
      g.camera.updateProjectionMatrix();
      document.getElementById('startScreen').style.display='none';
      g.canvas.style.filter='none';
      g.renderer.render(g.scene,g.camera);
      return {x:wx,y,z:wz,face:actual.face,adCount:chunk.adEntries.length,
        grassAds:[...w.chunks.values()].flatMap(c=>c.adEntries).filter(a=>w.getBlock(a.x,a.y,a.z)!==BlockType.DIAMOND_ORE).length};
    }
    throw Error('No eligible naturally generated diamond in chosen chunk');
  });
  assert.equal(result.grassAds,0);
  await mkdir('docs/verification',{recursive:true});
  await page.locator('#gameCanvas').screenshot({path:'docs/verification/diamond-microtext-close.png'});
  const underside=await page.evaluate(async()=>{
    const {BlockType}=await import('/js/voxel.js');
    const g=window.__oreGame,w=g.world,chunk=g._createChunk(3,3);
    const x=52,y=18,z=61;
    if(chunk.getBlock(x-48,y,z-48)!==BlockType.DIAMOND_ORE)throw Error('Expected natural ore missing');
    w.setBlock(x,y-1,z,BlockType.AIR);
    // Clear a small viewing shaft underneath the natural ore.
    for(let dy=2;dy<=4;dy++)w.setBlock(x,y-dy,z,BlockType.AIR);
    chunk.buildMesh((X,Y,Z)=>w.getBlock(X,Y,Z),w.material,w.waterMaterial);
    if(chunk.mesh&&!chunk.mesh.parent)g.scene.add(chunk.mesh);
    if(chunk.adMesh&&!chunk.adMesh.parent)g.scene.add(chunk.adMesh);
    const ad=chunk.adEntries.find(a=>a.x===x&&a.y===y&&a.z===z&&a.face[1]===-1);
    if(!ad)throw Error('No underside inscription');
    g.camera.position.set(x+.5,y-2.7,z+.5);
    g.camera.lookAt(x+.5,y-.4,z+.5);
    g.renderer.render(g.scene,g.camera);
    return {x,y,z,face:ad.face};
  });
  await page.locator('#gameCanvas').screenshot({path:'docs/verification/diamond-microtext-underside.png'});
  console.log('PASS natural diamond underside microtext',underside);
  assert.deepEqual(pageErrors,[]);
  console.log('PASS natural diamond microtext',result);
} finally {
  if(browser)await browser.close();
  await new Promise(r=>server.close(r));
}
