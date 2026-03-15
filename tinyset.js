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
// tinyset.js v2.6
export const where={
eq:(k,v)=>i=>i[k]===v,ne:(k,v)=>i=>i[k]!==v,gt:(k,v)=>i=>i[k]>v,gte:(k,v)=>i=>i[k]>=v,
lt:(k,v)=>i=>i[k]<v,lte:(k,v)=>i=>i[k]<=v,in:(k,a)=>i=>a.includes(i[k]),
contains:(k,v)=>i=>String(i[k]).includes(v),startsWith:(k,v)=>i=>String(i[k]).startsWith(v),
endsWith:(k,v)=>i=>String(i[k]).endsWith(v),exists:k=>i=>i[k]!==undefined,
and:(...f)=>i=>f.every(fn=>fn(i)),or:(...f)=>i=>f.some(fn=>fn(i))
}

export function createStore(o={}){
const items=new Map(),meta=new Map(),listeners=new Map()
const idx={type:new Map(),spatial:new Map(),coords:new Map()}

const cfg={
id:o.idGenerator||(()=>`${Date.now()}-${Math.random().toString(36).slice(2,9)}`),
types:o.types||new Set(),defs:o.defaults||{},grid:o.spatialGridSize||100
}

meta.set('cfg',cfg)

const emit=(e,d)=>listeners.get(e)?.forEach(cb=>{try{cb(d)}catch{}})

const ui=(a,it,old)=>{
let t=idx.type.get(it.type)
if(!t)idx.type.set(it.type,t=new Set())
if(a=='add')t.add(it.id)
else if(a=='remove')t.delete(it.id)
else if(a=='update'&&old?.type!==it.type){idx.type.get(old.type)?.delete(it.id);t.add(it.id)}

if(it.x!=null){
const g=cfg.grid,k=`${Math.floor(it.x/g)},${Math.floor(it.y/g)}`
idx.coords.set(it.id,{x:it.x,y:it.y})
if(a=='add'){if(!idx.spatial.has(k))idx.spatial.set(k,new Set());idx.spatial.get(k).add(it.id)}
else if(a=='remove'){idx.spatial.get(k)?.delete(it.id);idx.coords.delete(it.id)}
else if(a=='update'&&old){
const ok=`${Math.floor(old.x/g)},${Math.floor(old.y/g)}`
if(ok!==k){idx.spatial.get(ok)?.delete(it.id);if(!idx.spatial.has(k))idx.spatial.set(k,new Set());idx.spatial.get(k).add(it.id)}
}}
}

const w=(id,ch,o={})=>{
const old=items.get(id),now=Date.now()
const changes=typeof ch==='function'?ch(old):ch
const it=old?{...old,...changes,modified:now}:{id,created:now,modified:now,...changes}
if(cfg.types.size&&!cfg.types.has(it.type))throw Error(`Invalid type: ${it.type}`)
items.set(id,it);ui(old?'update':'add',it,old)
if(!o.silent){emit(old?'update':'create',{id,item:it,old});emit('change',{type:old?'update':'create',id,item:it})}
meta.get('tx')?.at(-1)?.push({type:old?'update':'create',id,old,new:it})
return it
}

const spatial=(type,x,y,max,p)=>{
const ts=idx.type.get(type);if(!ts)return[]
const g=cfg.grid,m=max*max
const minX=Math.floor((x-max)/g),maxX=Math.floor((x+max)/g)
const minY=Math.floor((y-max)/g),maxY=Math.floor((y+max)/g)

const cand=new Set()
for(let cx=minX;cx<=maxX;cx++)
for(let cy=minY;cy<=maxY;cy++)
idx.spatial.get(`${cx},${cy}`)?.forEach(id=>ts.has(id)&&cand.add(id))

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

const find=(t,p)=>{
const ts=idx.type.get(t);if(!ts)return Q([])
const r=[]
for(const id of ts){const it=items.get(id);if(it&&(!p||p(it)))r.push(it)}
return Q(r)
}

const near=(t,x,y,d,p)=>Q(spatial(t,x,y,d,p))

const get=id=>{const it=items.get(id);return it?{...it}:null}
const ref=id=>items.get(id)||null
const pick=(id,f)=>{const it=items.get(id);if(!it)return null;const o={};for(const k of f)o[k]=it[k];return o}

const rm=(id)=>{
const it=items.get(id);if(!it)return null
items.delete(id);ui('remove',it)
emit('delete',{id,item:it});emit('change',{type:'delete',id,item:it})
meta.get('tx')?.at(-1)?.push({type:'delete',id,item:it})
return it
}

const tx=fn=>{
const t=meta.get('tx')||[];meta.set('tx',[...t,[]])
try{const r=fn();meta.set('tx',t);return r}
catch(e){
for(const op of meta.get('tx').pop().reverse())
op.type=='create'?items.delete(op.id):op.type=='update'?items.set(op.id,op.old):items.set(op.id,op.item)
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
once:(e,cb)=>{let w=d=>{cb(d);listeners.get(e)?.delete(w)};listeners.get(e)?.add(w);return()=>listeners.get(e)?.delete(w)},
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
