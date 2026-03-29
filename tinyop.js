// Copyright (C) 2026 R Balog
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3 of the License
//
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
// v3.6.3: fixed transaction + spatial index consistency on rollback restored _isArray fast-path for cf → no performance regression
//         
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
  const qbump=(t,cf)=>{const hm=qh.get(t);if(hm?.size){if(!cf)hm.clear();else{const d=[];hm.forEach((_,k)=>{const pf=_gf(k);if(cf._isArray){for(let i=0;i<cf.length;i++)if(pf.has(cf[i])){d.push(k);break;}}else{for(const f of cf)if(pf.has(f)){d.push(k);break;}}});for(let i=0;i<d.length;i++)hm.delete(d[i]);}}if(qi.size)for(const m of qi.values())m.delete(t);const v=versions.get(t);if(v){v.version++;v.views.forEach(f=>f());}};
const w = (id, ch, o={}) => {
    const old=items.get(id), changes=typeof ch=='function'?ch(old):ch;
    if(old){
      const inTx=!!meta.get('tx'), hasListeners=listeners.has('update')||listeners.has('change'), now=Date.now();
      const oldForTx=inTx?{...old}:null, oldForUi={type:old.type,x:old.x,y:old.y};
      let snap=!o.silent&&hasListeners?{...old}:null;

      if(cfg.types.size&&!cfg.types.has(changes?.type||old.type)) throw Error(`Invalid type: ${changes?.type||old.type}`);

      if(changes&&typeof changes=='object'&&changes.constructor===Object){
        const ks=Object.keys(changes);
        for(let i=0;i<ks.length;i++) old[ks[i]]=changes[ks[i]];
      }else if(changes) Object.assign(old,changes);

      old.modified=now;

      const qhType=qh.get(old.type);
      let cf=null;
      if(qhType?.size&&changes&&typeof changes=='object'&&changes.constructor===Object){
        const ks=Object.keys(changes);
        cf=ks.length<8 ? {has:f=>ks.includes(f),size:ks.length,_isArray:true} : new Set(ks);
      }

      const hasSpatial= !cf || (cf._isArray ? cf.has('x')||cf.has('y') : cf.has('x')||cf.has('y'));

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
  const near=(t,x,y,d,p)=>Q(spatial(t,x,y,d,p));
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
          ui('update',op.old,{type:op.old.type,x:op.old.x,y:op.old.y},true); 
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
