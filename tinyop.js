// Copyright (C) 2026 R Balog
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3 of the License
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
// GNU General Public License for more details.
// You should have received a copy of the GNU General Public License
// along with this program. If not, see <https://www.gnu.org/licenses/>.
// v3.5: field-aware cache invalidation — writes only evict predicates that touch changed fields
// v3.5.1: spatial index skip on non-spatial writes; Array cand in near(); batch qbump; qi size guard
// tinyop.js v3.6.0 - compact store with queries, spatial indexing, views, transactions
// v3.6.1: adaptive performance — skip Set creation when cache cold, timestamp only when needed,
// v3.6.2: optimized for V8 deop count lowered
// v3.6.3: fixed transaction + spatial index consistency on rollback
// v3.6.4: subfield-aware invalidation
// v3.6.5 includes performance tuning for spatial queries
const VERSION=Symbol('version'), _k=(f,k)=>(f._key=k,f);
export const where={
  eq:(k,v)=>_k(i=>i[k]===v,`eq:${k}:${v}`), ne:(k,v)=>i=>i[k]!==v,
  gt:(k,v)=>_k(i=>i[k]>v,`gt:${k}:${v}`), gte:(k,v)=>_k(i=>i[k]>=v,`gte:${k}:${v}`),
  lt:(k,v)=>_k(i=>i[k]<v,`lt:${k}:${v}`), lte:(k,v)=>_k(i=>i[k]<=v,`lte:${k}:${v}`),
  in:(k,a)=>_k(i=>a.includes(i[k]),`in:${k}:${a}`), contains:(k,v)=>i=>String(i[k]).includes(v),
  startsWith:(k,v)=>i=>String(i[k]).startsWith(v), endsWith:(k,v)=>i=>String(i[k]).endsWith(v),
  exists:k=>i=>i[k]!==undefined,
  and:(...fs)=>{const f=i=>fs.every(f=>f(i)), ks=fs.map(x=>x?._key); f._key=ks.every(Boolean)?`and(${ks})`:null; return f},
  or:(...fs)=>{const f=i=>fs.some(f=>f(i)), ks=fs.map(x=>x?._key); f._key=ks.every(Boolean)?`or(${ks})`:null; return f}
};
const _fc=new Map(), _gf=k=>{let f=_fc.get(k);if(!f){const m=k.match(/(?:eq|ne|gt|gte|lt|lte|in|exists):([^:,)]+)/g)||[];f=new Set(m.map(s=>s.split(':')[1]));_fc.set(k,f);}return f;};
const _isPlainObject=v=>v&&typeof v=='object'&&v.constructor===Object;
const _diffPaths=(oldObj,newObj,prefix)=>{const out=[];const stack=[{old:oldObj,new:newObj,prefix}];while(stack.length){const item=stack.pop(),{old,new:ne,prefix:pr}=item;const keys=new Set([...Object.keys(old),...Object.keys(ne)]);for(const k of keys){const ov=old[k], nv=ne[k];if(ov===nv) continue;const path=`${pr}.${k}`;if(_isPlainObject(ov)&&_isPlainObject(nv)){stack.push({old:ov,new:nv,prefix:path});}else{out.push(path);}}}return out;};
const _pathsIntersect=(fieldPath,changedPath)=>fieldPath===changedPath||fieldPath.startsWith(changedPath+'.')||changedPath.startsWith(fieldPath+'.');
const _predicateNeedsInvalidate=(pf,cf)=>{if(!pf||!cf||(!cf._isArray&&cf instanceof Set&&cf.size===0)) return false;const changed = cf._isArray ? cf : cf instanceof Set ? [...cf] : [cf];for(const f of pf){for(const c of changed){if(_pathsIntersect(f,c)) return true;}}return false;};
export function createStore(o={}){
  const items=new Map(), meta=new Map(), listeners=new Map(), idx={type:new Map(), spatial:new Map(), coords:new Map()};
  let _id=0; const cfg={id:o.idGenerator||(()=>String(++_id)), types:o.types||new Set(), defs:o.defaults||{}, grid:o.spatialGridSize||100};
  meta.set('cfg',cfg);
  const emit=(e,d)=>{const s=listeners.get(e); s?.forEach(cb=>{try{cb(d)}catch{}})};
  const ui=(a,it,old,sp)=>{
    let t=idx.type.get(it.type); if(!t) idx.type.set(it.type,t=new Set());
    if(a=='add') t.add(it.id);
    else if(a=='remove'){ t.delete(it.id); if(!t.size) idx.type.delete(it.type); }
    else if(a=='update'&&old?.type!==it.type){ idx.type.get(old.type)?.delete(it.id); t.add(it.id); }
    if(it.x!=null&&sp!==false){
      const g=cfg.grid, cx=Math.floor(it.x/g), cy=Math.floor(it.y/g), k=cx*1e9+cy;
      idx.coords.set(it.id,{x:it.x,y:it.y});
      if(a=='add'){ if(!idx.spatial.has(k)) idx.spatial.set(k,new Set()); idx.spatial.get(k).add(it.id); }
      else if(a=='remove'){ idx.spatial.get(k)?.delete(it.id); idx.coords.delete(it.id); }
      else if(a=='update'&&old){
        const ocx=Math.floor(old.x/g), ocy=Math.floor(old.y/g), ok=ocx*1e9+ocy;
        if(ok!==k){ idx.spatial.get(ok)?.delete(it.id); if(!idx.spatial.has(k)) idx.spatial.set(k,new Set()); idx.spatial.get(k).add(it.id); }
      }
    }
  };
  const versions=new Map(), qh=new Map(), qi=new Map(), MAX_QH=128;
  const qbump=(t,cf)=>{const hm=qh.get(t);if(hm?.size){if(!cf)hm.clear();else{const d=[];hm.forEach((_,k)=>{const pf=_gf(k);if(_predicateNeedsInvalidate(pf,cf)){d.push(k);} });for(let i=0;i<d.length;i++)hm.delete(d[i]);}}if(qi.size)for(const m of qi.values())m.delete(t);const v=versions.get(t);if(v){v.version++;v.views.forEach(f=>f());}};
const w = (id, ch, o={}) => {
    const old=items.get(id), changes=typeof ch=='function'?ch(old):ch;
    if(old){
      const inTx=!!meta.get('tx'), hasListeners=listeners.has('update')||listeners.has('change'), now=Date.now();
      const oldForTx=inTx?{...old}:null, oldForUi={type:old.type,x:old.x,y:old.y};
      let snap=!o.silent&&hasListeners?{...old}:null;
      if(cfg.types.size&&!cfg.types.has(changes?.type||old.type)) throw Error(`Invalid type: ${changes?.type||old.type}`);
      let cf=null;
      if(changes&&typeof changes=='object'&&changes.constructor===Object){
        const ks=Object.keys(changes);
        const changedFields=[];
        for(const k of ks){
          const oldVal=old[k], newVal=changes[k];
          if(_isPlainObject(oldVal) && _isPlainObject(newVal)){
            const subPaths=_diffPaths(oldVal,newVal,k);
            if(subPaths.length) changedFields.push(...subPaths);
          } else if(oldVal!==newVal){
            changedFields.push(k);
          }
          old[k]=changes[k];
        }
        if(changedFields.length){ cf = changedFields.length<8 ? (changedFields._isArray=true,changedFields) : new Set(changedFields); }
      } else if(changes) {
        Object.assign(old,changes);
      }
      old.modified=now;
      const qhType=qh.get(old.type);      const hasSpatial= !cf || (cf._isArray ? (cf.includes('x')||cf.includes('y')) : (cf.has('x')||cf.has('y')));
      ui('update',old,oldForUi,hasSpatial);
      if(cf) qbump(old.type,cf);
      if(!o.silent&&hasListeners){
        emit('update',{id,item:old,old:snap});
        emit('change',{type:'update',id,item:old});
      }
      if(inTx) meta.get('tx').at(-1).push({type:'update',id,old:oldForTx,new:{...old}});
      return old;
    }else{
      const now=Date.now(), it={id,created:now,modified:now,...changes};
      if(cfg.types.size&&!cfg.types.has(it.type)) throw Error(`Invalid type: ${it.type}`);
      items.set(id,it); ui('add',it,null,null); qbump(it.type,null);
      if(!o.silent){
        emit('create',{id,item:it,old:null});
        emit('change',{type:'create',id,item:it});
      }
      if(meta.get('tx')) meta.get('tx').at(-1).push({type:'create',id,old:null,new:{...it}});
      return it;
    }
  };
  const Q=a=>({ all:()=>a, first:()=>a[0]||null, last:()=>a.at(-1)||null, count:()=>a.length, ids:()=>a.map(x=>x.id),
    limit:n=>Q(a.slice(0,n)), offset:n=>Q(a.slice(n)), sort:f=>Q([...a].sort((x,y)=>(x[f]??0)<(y[f]??0)?-1:1)) });
  const view=(type,pred,opts={})=>{ let cache=null, version=-1, {spatial,x,y,r,threshold=0}=opts;
    let v=versions.get(type); if(!v) versions.set(type,v={version:0,views:new Set()});
    const invalidate=()=>{ version=-1; }; v.views.add(invalidate);
    const compute=()=> spatial? near(type,x,y,r,pred).all() : find(type,pred).all();
    const get=()=>{ if(version!==v.version){ cache=compute(); version=v.version; } return cache; };
    get.recenter=(nx,ny)=>{ if(!spatial) return; if(threshold&&Math.hypot(nx-x,ny-y)<=threshold) return; x=nx; y=ny; if(v.version===version) version--; };
    get.destroy=()=> v.views.delete(invalidate); return get;
  };
  const find=(t,p)=>{ const ck=p?._key??null;
    if(ck!=null){ let hm=qh.get(t); if(hm){ const q=hm.get(ck); if(q) return q; }
      const ts=idx.type.get(t), r=[]; if(ts) for(const id of ts){ const it=items.get(id); if(it&&(!p||p(it))) r.push(it); }
      const q=Q(r); if(!hm){ hm=new Map(); qh.set(t,hm); } if(hm.size>=MAX_QH) hm.delete(hm.keys().next().value); hm.set(ck,q); return q;
    }
    const rk=p||'__none__', m=qi.get(rk); if(m){ const c=m.get(t); if(c) return c; }
    const ts=idx.type.get(t), r=[]; if(ts) for(const id of ts){ const it=items.get(id); if(it&&(!p||p(it))) r.push(it); }
    const q=Q(r); if(!m){ if(qi.size>=MAX_QH) qi.delete(qi.keys().next().value); qi.set(rk,new Map().set(t,q)); } else m.set(t,q); return q;
  };
  const spatial=(type,x,y,max,p,sorted=true)=>{
    const ts=idx.type.get(type); if(!ts) return[];
    const g=cfg.grid, m=max*max;
    const minCX=Math.floor((x-max)/g), maxCX=Math.floor((x+max)/g);
    const minCY=Math.floor((y-max)/g), maxCY=Math.floor((y+max)/g);
    const cand=[];
    for(let cx=minCX; cx<=maxCX; cx++)
      for(let cy=minCY; cy<=maxCY; cy++)
        idx.spatial.get(cx*1e9+cy)?.forEach(id=>ts.has(id)&&cand.push(id));
    const r=[];
    for(const id of cand){
      const p0=idx.coords.get(id); if(!p0) continue;
      const dx=p0.x-x, dy=p0.y-y, ds=dx*dx+dy*dy;
      if(ds<=m){ const it=items.get(id); if(it&&(!p||p(it))) r.push({it,ds}); }
    }
    if(sorted) r.sort((a,b)=>a.ds-b.ds);
    return r.map(v=>v.it);
  };
  const near=(t,x,y,d,p,sorted=true)=>Q(spatial(t,x,y,d,p,sorted));
  const get=id=>{ const it=items.get(id); return it?{...it}:null; };
  const ref=id=>items.get(id)||null;
  const pick=(id,f)=>{ const it=items.get(id); if(!it) return null; const o={}; for(const k of f){ const v=it[k]; o[k]=v&&typeof v=='object'?structuredClone(v):v; } return o; };
  const rm=id=>{ const it=items.get(id); if(!it) return null;
    items.delete(id); ui('remove',it); qbump(it.type,null);
    emit('delete',{id,item:it}); emit('change',{type:'delete',id,item:it});
    meta.get('tx')?.at(-1)?.push({type:'delete',id,item:{...it}}); return it;
  };
const tx=fn=>{ 
    const t=meta.get('tx')||[]; 
    meta.set('tx',[...t,[]]);
    try{ 
      const r=fn(); 
      meta.set('tx',t); 
      return r; 
    }catch(e){
      for(const op of meta.get('tx').pop().reverse()){
        if(op.type=='create'){ items.delete(op.id); ui('remove',op.new); }
        else if(op.type=='update'){ 
          items.set(op.id,op.old); 
          ui('update',op.old,{type:op.new.type,x:op.new.x,y:op.new.y},true); 
        }
        else{ items.set(op.id,op.item); ui('add',op.item,null,null); }
      }
      meta.set('tx',t); 
      throw e; 
    }
  };
  const createOne=(t,p={})=>w(p.id||cfg.id(),{type:t,...cfg.defs[t],...p});
  const _batchUpdate=updates=>{ const res=[];
    for(const{id,changes}of updates){ const r=items.has(id)?w(id,changes,{silent:true}):null; if(r) res.push(r); }
    if(res.length){ emit('batch',{op:'update',count:res.length}); emit('change',{type:'batch',op:'update',count:res.length}); }
    return res;
  };
  const _batchDelete=ids=>{ const del=[], types=new Set();
    for(const id of ids){ const it=items.get(id); if(!it) continue;
      items.delete(id); ui('remove',it,null,null); types.add(it.type);
      meta.get('tx')?.at(-1)?.push({type:'delete',id,item:{...it}}); del.push(it);
    }
    for(const t of types) qbump(t,null);
    if(del.length){ emit('batch',{op:'delete',count:del.length}); emit('change',{type:'batch',op:'delete',count:del.length}); }
    return del;
  };
  return {
    create:createOne, createMany:(t,arr)=>arr.map(p=>createOne(t,p)),
    update:(id,c)=>items.has(id)?w(id,c):null, set:(id,f,v)=>items.has(id)?w(id,{[f]:v}):null,
    increment:(id,f,b=1)=>{ const it=items.get(id); return it?w(id,{[f]:(it[f]||0)+b}):null; },
    get, getRef:ref, pick, exists:id=>items.has(id),
    find, near, count:(t,p)=>find(t,p).count(),
    delete:rm, deleteMany:_batchDelete,
    batch:{ create:(t,arr)=>arr.map(p=>createOne(t,p)), update:_batchUpdate, delete:_batchDelete },
    clear:()=>{ const c=items.size; items.clear(); idx.type.clear(); idx.spatial.clear(); idx.coords.clear(); return c; },
    transaction:tx,
    on:(e,cb)=>{ if(!listeners.has(e)) listeners.set(e,new Set()); listeners.get(e).add(cb); return ()=>listeners.get(e)?.delete(cb); },
    once:(e,cb)=>{ if(!listeners.has(e)) listeners.set(e,new Set()); const w=d=>{ cb(d); listeners.get(e)?.delete(w); }; listeners.get(e).add(w); return ()=>listeners.get(e)?.delete(w); },
    off:(e,cb)=>listeners.get(e)?.delete(cb),
    dump:()=>Object.fromEntries([...items].map(([k,v])=>[k,{...v}])),
    stats:()=>({ items:items.size, types:Object.fromEntries([...idx.type].map(([t,s])=>[t,s.size])),
                spatial:{cells:idx.spatial.size,coords:idx.coords.size}, listeners:Object.fromEntries([...listeners].map(([e,s])=>[e,s.size])) }),
    meta:{ get:k=>meta.get(k), set:(k,v)=>meta.set(k,v), config:()=>({...cfg}) }, view
  };
}
