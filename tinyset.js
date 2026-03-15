//    Copyright (C) 2026  R Balog
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, version 3 of the License
//
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.
// tinyset.js v2.9
// _key: stable serialised string on all where.* predicates — enables compound query caching
const _k=(f,key)=>{f._key=key;return f}
export const where={
eq: (k,v)=>_k(i=>i[k]===v,  `eq:${k}:${v}`),
ne: (k,v)=>     i=>i[k]!==v,
gt: (k,v)=>_k(i=>i[k]>v,    `gt:${k}:${v}`),
gte:(k,v)=>_k(i=>i[k]>=v,   `gte:${k}:${v}`),
lt: (k,v)=>_k(i=>i[k]<v,    `lt:${k}:${v}`),
lte:(k,v)=>_k(i=>i[k]<=v,   `lte:${k}:${v}`),
in: (k,a)=>_k(i=>a.includes(i[k]),`in:${k}:${a}`),
contains:  (k,v)=>i=>String(i[k]).includes(v),
startsWith:(k,v)=>i=>String(i[k]).startsWith(v),
endsWith:  (k,v)=>i=>String(i[k]).endsWith(v),
exists:    k    =>i=>i[k]!==undefined,
and:(...fs)=>{const f=i=>fs.every(fn=>fn(i));const ks=fs.map(x=>x?._key);f._key=ks.every(Boolean)?`and(${ks})`:null;return f},
or: (...fs)=>{const f=i=>fs.some(fn=>fn(i)); const ks=fs.map(x=>x?._key);f._key=ks.every(Boolean)?`or(${ks})` :null;return f}
}

export function createStore(o={}){
const items=new Map(),meta=new Map(),listeners=new Map()
const idx={type:new Map(),spatial:new Map(),coords:new Map()}

// v2.7: counter id 52x faster than Date+random, still unique per store instance
// set idGenerator in options to override (e.g. for distributed scenarios)
let _id=0
const cfg={
id:o.idGenerator||(()=>String(++_id)),
types:o.types||new Set(),defs:o.defaults||{},grid:o.spatialGridSize||100
}

meta.set('cfg',cfg)

// v2.7: emit only when listeners exist skip Map.get + forEach when no subscribers
const emit=(e,d)=>{const s=listeners.get(e);if(s&&s.size)s.forEach(cb=>{try{cb(d)}catch{}})}

const ui=(a,it,old)=>{
let t=idx.type.get(it.type)
if(!t)idx.type.set(it.type,t=new Set())
if(a=='add')t.add(it.id)
else if(a=='remove')t.delete(it.id)
else if(a=='update'&&old?.type!==it.type){idx.type.get(old.type)?.delete(it.id);t.add(it.id)}

if(it.x!=null){
// v2.7: numeric spatial key — no string allocation, 5x faster Map lookup
const g=cfg.grid,cx=Math.floor(it.x/g),cy=Math.floor(it.y/g),k=cx*1e6+cy
idx.coords.set(it.id,{x:it.x,y:it.y})
if(a=='add'){if(!idx.spatial.has(k))idx.spatial.set(k,new Set());idx.spatial.get(k).add(it.id)}
else if(a=='remove'){idx.spatial.get(k)?.delete(it.id);idx.coords.delete(it.id)}
else if(a=='update'&&old){
const ocx=Math.floor(old.x/g),ocy=Math.floor(old.y/g),ok=ocx*1e6+ocy
if(ok!==k){idx.spatial.get(ok)?.delete(it.id);if(!idx.spatial.has(k))idx.spatial.set(k,new Set());idx.spatial.get(k).add(it.id)}
}}
}

const w=(id,ch,o={})=>{
// v2.7: single Date.now() call per write (was 2)
const now=Date.now()
const old=items.get(id)
const changes=typeof ch==='function'?ch(old):ch

// v2.7: update mutates in-place instead of spreading a new object
// get() returns a copy so external refs are safe; getRef() intentionally exposes live obj
// old snapshot taken before mutation so update events receive correct prior state
let it
if(old){
// snapshot old state for event emission before mutating
const snap=o.silent?null:{...old}
Object.assign(old,changes);old.modified=now;it=old
if(cfg.types.size&&!cfg.types.has(it.type))throw Error(`Invalid type: ${it.type}`)
items.set(id,it);ui('update',it,snap);qbump(it.type)
if(!o.silent){emit('update',{id,item:it,old:snap});emit('change',{type:'update',id,item:it})}
meta.get('tx')?.at(-1)?.push({type:'update',id,old:snap,new:{...it}})
}else{
it={id,created:now,modified:now,...changes}
if(cfg.types.size&&!cfg.types.has(it.type))throw Error(`Invalid type: ${it.type}`)
items.set(id,it);ui('add',it,null);qbump(it.type)
if(!o.silent){emit('create',{id,item:it,old:null});emit('change',{type:'create',id,item:it})}
meta.get('tx')?.at(-1)?.push({type:'create',id,old:null,new:{...it}})
}
return it
}

const spatial=(type,x,y,max,p)=>{
const ts=idx.type.get(type);if(!ts)return[]
const g=cfg.grid,m=max*max
const minCX=Math.floor((x-max)/g),maxCX=Math.floor((x+max)/g)
const minCY=Math.floor((y-max)/g),maxCY=Math.floor((y+max)/g)

const cand=new Set()
for(let cx=minCX;cx<=maxCX;cx++)
for(let cy=minCY;cy<=maxCY;cy++)
idx.spatial.get(cx*1e6+cy)?.forEach(id=>ts.has(id)&&cand.add(id))

const r=[]
for(const id of cand){
const p0=idx.coords.get(id);if(!p0)continue
const dx=p0.x-x,dy=p0.y-y,ds=dx*dx+dy*dy
if(ds<=m){const it=items.get(id);if(it&&(!p||p(it)))r.push({it,ds})}
}
return r.sort((a,b)=>a.ds-b.ds).map(v=>v.it)
}

const Q=a=>({
all:()=>a,first:()=>a[0]||null,last:()=>a.at(-1)||null,count:()=>a.length,ids:()=>a.map(x=>x.id),
limit:n=>Q(a.slice(0,n)),offset:n=>Q(a.slice(n)),
sort:f=>Q([...a].sort((x,y)=>{const A=x[f]??0,B=y[f]??0;return A<B?-1:A>B?1:0}))
})

// hot/cold query cache
// cold: Map keyed by string (tagged predicates) or fn reference (inline/compound-with-inline)
// hot:  Map<type, Map<predKey, Q>> — nested by type so qbump evicts in O(1) via .clear()
//       promoted after THRESH cold hits; returns frozen Q, bypasses version check
// per-type version counters: write to 'enemy' never touches 'player' cache entries
// compound where.and/or carry _key when all sub-predicates are tagged — now cacheable
const qc=new Map(),qv=new Map(),qh=new Map()
const THRESH=3
const qbump=t=>{
  qv.set(t,(qv.get(t)||0)+1)
  qh.get(t)?.clear()  // O(1) — clears inner Map for this type only
}

const find=(t,p)=>{
const sk=p?._key,ck=sk!=null?sk:null
// hot path: tagged predicates only, nested by type — two Map.get calls, no version check
if(ck){const hm=qh.get(t);if(hm){const q=hm.get(ck);if(q)return q}}
const ver=qv.get(t)||0
// cold path: string key
if(ck){
  const c=qc.get(`${t}\0${ck}`)
  if(c&&c.ver===ver){
    if(++c.h>=THRESH){
      const q=Q(c.r)
      if(!qh.has(t))qh.set(t,new Map())
      qh.get(t).set(ck,q);return q
    }
    return Q(c.r)
  }
  const ts=idx.type.get(t),r=[]
  if(ts)for(const id of ts){const it=items.get(id);if(it&&(!p||p(it)))r.push(it)}
  qc.set(`${t}\0${ck}`,{ver,r,h:0});return Q(r)
}
// ref key: inline functions and compounds containing inline predicates
const rk=p||'__none__'
if(!qc.has(rk))qc.set(rk,new Map())
const m=qc.get(rk),c=m.get(t)
if(c&&c.ver===ver)return Q(c.r)
const ts=idx.type.get(t),r=[]
if(ts)for(const id of ts){const it=items.get(id);if(it&&(!p||p(it)))r.push(it)}
m.set(t,{ver,r});return Q(r)
}

const near=(t,x,y,d,p)=>Q(spatial(t,x,y,d,p))

const get=id=>{const it=items.get(id);return it?{...it}:null}
const ref=id=>items.get(id)||null
const pick=(id,f)=>{const it=items.get(id);if(!it)return null;const o={};for(const k of f)o[k]=it[k];return o}

const rm=id=>{
const it=items.get(id);if(!it)return null
items.delete(id);ui('remove',it);qbump(it.type)
emit('delete',{id,item:it});emit('change',{type:'delete',id,item:it})
meta.get('tx')?.at(-1)?.push({type:'delete',id,item:{...it}})
return it
}

const tx=fn=>{
const t=meta.get('tx')||[];meta.set('tx',[...t,[]])
try{const r=fn();meta.set('tx',t);return r}
catch(e){
// rollback: restore snapshots recorded during the transaction
for(const op of meta.get('tx').pop().reverse()){
if(op.type=='create')items.delete(op.id)
else if(op.type=='update'){items.set(op.id,op.old);ui('update',op.old,op.new)}
else items.set(op.id,op.item)
}
meta.set('tx',t);throw e}
}

const createOne=(t,p={})=>w(p.id||cfg.id(),{type:t,...cfg.defs[t],...p})

return{
create:createOne,
createMany:(t,arr)=>arr.map(p=>createOne(t,p)),
update:(id,c)=>items.has(id)?w(id,c):null,
set:(id,f,v)=>items.has(id)?w(id,{[f]:v}):null,
increment:(id,f,b=1)=>{const it=items.get(id);return it?w(id,{[f]:(it[f]||0)+b}):null},

get,getRef:ref,pick,exists:id=>items.has(id),

find,near,count:(t,p)=>find(t,p).count(),

delete:rm,deleteMany:ids=>ids.map(id=>rm(id)),

clear:()=>{const c=items.size;items.clear();idx.type.clear();idx.spatial.clear();idx.coords.clear();return c},

transaction:tx,

on:(e,cb)=>{if(!listeners.has(e))listeners.set(e,new Set());listeners.get(e).add(cb);return()=>listeners.get(e)?.delete(cb)},
once:(e,cb)=>{if(!listeners.has(e))listeners.set(e,new Set());let w=d=>{cb(d);listeners.get(e)?.delete(w)};listeners.get(e).add(w);return()=>listeners.get(e)?.delete(w)},
off:(e,cb)=>listeners.get(e)?.delete(cb),

dump:()=>Object.fromEntries([...items].map(([k,v])=>[k,{...v}])),

stats:()=>({
items:items.size,
types:Object.fromEntries([...idx.type].map(([t,s])=>[t,s.size])),
spatial:{cells:idx.spatial.size,coords:idx.coords.size},
listeners:Object.fromEntries([...listeners].map(([e,s])=>[e,s.size]))
}),

meta:{get:k=>meta.get(k),set:(k,v)=>meta.set(k,v),config:()=>({...cfg})}
}
}
