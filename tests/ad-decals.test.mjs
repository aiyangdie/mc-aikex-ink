import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';
import {selectAdDecals, AD_TEXT, hasDiamondMicrotext} from '../js/ad-decals.js';
import {BlockType, Chunk, World, Dim} from '../js/voxel.js';

const diamondLayer = (x,y,z) => y === 20 && x >= 0 && x < 16 && z >= 0 && z < 16 ? BlockType.DIAMOND_ORE : BlockType.AIR;
const grassLayer = (x,y,z) => y === 20 && x >= 0 && x < 16 && z >= 0 && z < 16 ? BlockType.GRASS : BlockType.AIR;
const select = (dimension='overworld', getBlock=diamondLayer) => selectAdDecals({seed:12345,dimension,cx:0,cz:0,getBlock});

test('only overworld diamond ore is eligible, with stable seed and coordinate qualification', () => {
  assert.deepEqual(select(),select());
  assert.ok(select().length>0);
  assert.deepEqual(select('nether'),[]);
  assert.deepEqual(select('end'),[]);
  assert.notDeepEqual(select(),selectAdDecals({seed:12346,dimension:'overworld',cx:0,cz:0,getBlock:diamondLayer}));
  assert.deepEqual(select('overworld',grassLayer),[]);
  assert.deepEqual(select('overworld',()=>BlockType.STONE),[]);
});
test('roughly a quarter of diamond ores carry text regardless of exposure',()=>{
  let qualified=0,total=0;
  for(let cx=0;cx<24;cx++)for(let cz=0;cz<16;cz++)
    for(let x=cx*16;x<cx*16+16;x++)for(let z=cz*16;z<cz*16+16;z++){
      total++;
      if(hasDiamondMicrotext(12345,'overworld',x,20,z))qualified++;
    }
  assert.ok(qualified/total>=.22&&qualified/total<=.28,`${qualified}/${total}`);
  assert.equal(hasDiamondMicrotext(12345,'nether',0,20,0),false);
});
test('decals remain on exposed diamond faces, not removed or covered ones', () => {
  const ads=select();
  assert.ok(ads.length>0 && ads.length<256);
  for(const ad of ads){
    assert.equal(diamondLayer(ad.x,ad.y,ad.z),BlockType.DIAMOND_ORE);
    assert.deepEqual(ad.face,[0,1,0]);
  }
  const ad=ads[0];
  const removed=(x,y,z)=>x===ad.x&&y===ad.y&&z===ad.z?BlockType.AIR:diamondLayer(x,y,z);
  assert.ok(!select('overworld',removed).some(a=>a.x===ad.x&&a.y===ad.y&&a.z===ad.z));
  const covered=(x,y,z)=>y===ad.y+1 && Math.abs(x-ad.x)+Math.abs(z-ad.z)===0 ? BlockType.STONE :
    y===ad.y && Math.abs(x-ad.x)+Math.abs(z-ad.z)===1 ? BlockType.STONE : diamondLayer(x,y,z);
  assert.ok(!select('overworld',covered).some(a=>a.x===ad.x&&a.y===ad.y&&a.z===ad.z));
  const isolated=(x,y,z)=>x===ad.x&&y===ad.y&&z===ad.z?BlockType.DIAMOND_ORE:BlockType.AIR;
  assert.equal(select('overworld',isolated).some(a=>a.x===ad.x&&a.y===ad.y&&a.z===ad.z),true);
});
test('rendered text is the exact approved Chinese phrase and domain',()=>{
  assert.equal(AD_TEXT,'激情大戏：spb.biily.top');
});
test('chunk rebuild and unload dispose decal geometry while sharing material',()=>{
  const scene=new THREE.Scene(),world=new World(scene,12345),chunk=new Chunk(0,0);
  for(let x=0;x<16;x++)for(let z=0;z<16;z++)chunk.setBlock(x,20,z,BlockType.DIAMOND_ORE);
  world.chunks.set('0,0',chunk);
  const material=new THREE.MeshBasicMaterial();
  world.adMaterial=material;
  world.configureChunkDecals(chunk);
  const get=(x,y,z)=>world.getBlock(x,y,z);
  chunk.buildMesh(get,material,material);
  assert.ok(chunk.adMesh && chunk.adMesh.geometry.getAttribute('position').count > 0);
  const old=chunk.adMesh.geometry;
  let disposed=false;old.addEventListener('dispose',()=>{disposed=true;});
  const first=chunk.adEntries[0];
  world.setBlock(first.x,first.y,first.z,BlockType.AIR);
  assert.equal(chunk.adMesh,null,'edit immediately removes stale decal');
  assert.equal(disposed,true);
  world.setBlock(first.x,first.y,first.z,BlockType.DIAMOND_ORE);
  chunk.buildMesh(get,material,material);
  assert.ok(chunk.adMesh);
  const newGeo=chunk.adMesh.geometry;
  let unloadDisposed=false;newGeo.addEventListener('dispose',()=>{unloadDisposed=true;});
  chunk.dispose();
  assert.equal(unloadDisposed,true);
  assert.equal(chunk.adMesh,null);
  material.dispose();
});
test('world teardown releases shared decal material and texture exactly once',()=>{
  const world=new World(new THREE.Scene());
  const map=new THREE.Texture();
  const material=new THREE.MeshBasicMaterial({map});
  let mapDisposed=0,materialDisposed=0;
  map.addEventListener('dispose',()=>mapDisposed++);
  material.addEventListener('dispose',()=>materialDisposed++);
  world.adMaterial=material;
  world.dispose();
  assert.equal(mapDisposed,1);
  assert.equal(materialDisposed,1);
  assert.equal(world.adMaterial,null);
});

test('Game creation, dimension switch, and terrain reset preserve final exposed decal faces', {timeout:120000}, async t=>{
  const server=http.createServer(async(req,res)=>{
    try {
      const pathname=new URL(req.url,'http://local').pathname;
      const file=new URL('../'+(pathname==='/'?'index.html':pathname.slice(1)),import.meta.url);
      let body=await readFile(file);
      if(pathname==='/js/game.js')body=body.toString().replace('const game = new Game();','const game = window.__game = new Game();');
      res.setHeader('Content-Type',pathname.endsWith('.js')?'text/javascript':pathname.endsWith('.css')?'text/css':'text/html');
      res.end(body);
    } catch {res.writeHead(404);res.end();}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,args:['--enable-unsafe-swiftshader']});
  t.after(async()=>{await browser.close();await new Promise(r=>server.close(r));});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('http://127.0.0.1:'+server.address().port+'/');
  await page.waitForFunction(()=>window.__game?.world?.adMaterial);
  const outcome=await page.evaluate(async()=>{
    const {selectAdDecals}=await import('/js/ad-decals.js');
    const g=window.__game,w=g.world;
    g._online=true;g.renderDistance=2;
    const clear=()=>{for(const c of w.chunks.values())c.dispose();w.chunks.clear();};
    const expected=()=>[...w.chunks.values()].map(c=>{
      const actual=c.adEntries;
      const final=selectAdDecals({seed:w.seed,dimension:w.dimension,cx:c.cx,cz:c.cz,getBlock:(x,y,z)=>w.getBlock(x,y,z)});
      return JSON.stringify(actual)===JSON.stringify(final);
    });
    const coords=[];for(let x=-4;x<=4;x++)for(let z=-4;z<=4;z++)coords.push([x,z]);
    const orders=[];
    for(const order of [coords,[...coords].reverse()]){
      clear();for(const [cx,cz] of order)g._createChunk(cx,cz);
      orders.push(expected().filter(Boolean).length);
    }
    const created=w.chunks.size;
    clear();await g._switchDimension('nether');
    const dimension={meshes:0,attached:0};
    for(const c of w.chunks.values())if(c.adMesh){dimension.meshes++;if(c.adMesh.parent===g.scene)dimension.attached++;}
    clear();g.dimension='overworld';w.setDimension('overworld');
    for(let cx=-1;cx<=1;cx++)for(let cz=-1;cz<=1;cz++)g._createChunk(cx,cz);
    for(const c of w.chunks.values())c.blocks.fill(0);
    g._replaceRoomTerrain({revision:1,editsByDimension:{overworld:[],nether:[],end:[]}});
    const reset={total:w.chunks.size,matching:expected().filter(Boolean).length};
    return {orders,created,dimension,reset};
  });
  await t.test('both creation orders converge on fully loaded exposed faces',()=>{
    assert.deepEqual(outcome.orders,[outcome.created,outcome.created]);
  });
  await t.test('dimension switch attaches each generated decal mesh',()=>{
    assert.equal(outcome.dimension.meshes,0,'Nether has no diamond microtext');
    assert.equal(outcome.dimension.attached,outcome.dimension.meshes);
  });
  await t.test('room reset rebuilds against all restored neighboring blocks',()=>{
    assert.equal(outcome.reset.matching,outcome.reset.total);
  });
  assert.deepEqual(errors,[]);
});
