const DIMENSIONS=['overworld','nether','end'];
const validDimension=dim=>DIMENSIONS.includes(dim)?dim:'overworld';
export class RoomTerrain {
  constructor(limit=60000){this.limit=limit;this.editsByDimension=Object.fromEntries(DIMENSIONS.map(dim=>[dim,new Map()]));}
  static fromPersist(row={},limit=60000){
    const terrain=new RoomTerrain(limit);
    if(row.editsByDimension)for(const dim of DIMENSIONS)terrain.applyEditsArray(row.editsByDimension[dim],dim);
    else terrain.applyEditsArray(row.edits,'overworld');
    return terrain;
  }
  getEdits(dim='overworld'){return this.editsByDimension[validDimension(dim)];}
  editsArray(dim='overworld'){
    const result=[];
    for(const [key,type] of this.getEdits(dim))result.push(...key.split(',').map(Number),type);
    return result;
  }
  toJSON(){return Object.fromEntries(DIMENSIONS.map(dim=>[dim,this.editsArray(dim)]));}
  get size(){return DIMENSIONS.reduce((sum,dim)=>sum+this.getEdits(dim).size,0);}
  applyEditsArray(arr,dim='overworld'){
    if(!Array.isArray(arr))return;
    for(let i=0;i+3<arr.length;i+=4)this.setBlock(arr[i],arr[i+1],arr[i+2],arr[i+3],dim);
  }
  setBlock(x,y,z,type,dim='overworld'){
    if(![x,y,z,type].every(Number.isFinite)||Math.abs(x)>4096||Math.abs(z)>4096||y<0||y>=48||type<0||type>255)return false;
    const map=this.getEdits(dim),key=[x|0,y|0,z|0].join(',');
    if(this.size>=this.limit&&!map.has(key))return false;
    map.set(key,type|0);return true;
  }
  applyBatch(edits,dim='overworld'){
    if(!Array.isArray(edits))return false;
    const map=this.getEdits(dim),newKeys=new Set();
    for(const edit of edits){
      if(!Array.isArray(edit)||edit.length!==4||!edit.every(Number.isFinite)||
         Math.abs(edit[0])>4096||Math.abs(edit[2])>4096||edit[1]<0||edit[1]>=48||edit[3]<0||edit[3]>255)return false;
      const key=edit.slice(0,3).map(Math.trunc).join(',');
      if(!map.has(key))newKeys.add(key);
    }
    if(this.size+newKeys.size>this.limit)return false;
    for(const edit of edits)this.setBlock(...edit,dim);
    return true;
  }
  clearAll(){const old=this.size;for(const map of Object.values(this.editsByDimension))map.clear();return old;}
}
