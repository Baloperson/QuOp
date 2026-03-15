import {createStore as createBaseStore}from'./tinyset.js'
export function createStore(opts={}){
const store=createBaseStore(opts)
const cfg={pid:opts.processId||`p-${Math.random().toString(36).slice(2,6)}`,batchDelay:opts.batchDelay||16,maxJournal:opts.maxJournalSize||10000,syncUrl:opts.syncUrl||null}
const clock=new Map([[cfg.pid,0]])
const clockInc=()=>clock.set(cfg.pid,(clock.get(cfg.pid)||0)+1)
const clockSnap=()=>Object.fromEntries(clock)
const clockMerge=c=>{for(const k in c)clock.set(k,Math.max(clock.get(k)||0,c[k]))}
const log=[];const logById=new Map();const listeners=new Set()
const record=(type,data)=>{clockInc();const ts=Date.now();const op={id:`${ts}-${Math.random().toString(36).slice(2,6)}`,type,data,pid:cfg.pid,clock:clockSnap(),ts};log.push(op);logById.set(op.id,op);if(log.length>cfg.maxJournal){const old=log.shift();logById.delete(old.id)}queueMicrotask(()=>listeners.forEach(cb=>{try{cb(op)}catch{}}));return op}
const exportOps=(since=0)=>{let i=0;while(i<log.length&&log[i].ts<=since)i++;return log.slice(i)}
const importOps=(ops)=>{let a=0;for(const o of ops){const l=clock.get(o.pid)||0,r=o.clock[o.pid]||0;if(r<=l)continue;const it=store.get(o.data.id);if(o.type=='create'&&!it)store.create(o.data.type,o.data.props);if(o.type=='update'&&it)store.update(o.data.id,o.data.changes);if(o.type=='delete'&&it)store.delete(o.data.id);clockMerge(o.clock);a++}return a}
const base={create:store.create,update:store.update,set:store.set,delete:store.delete,get:store.get}
store.create=(t,p)=>{const r=base.create.call(store,t,p);r&&record('create',{id:r.id,type:t,props:p});return r}
store.update=(id,c)=>{const o=base.get.call(store,id);const r=base.update.call(store,id,c);r&&record('update',{id,changes:c,old:o});return r}
store.set=(id,k,v)=>{const o=base.get.call(store,id);const r=base.set.call(store,id,k,v);if(r){const ch=typeof k=='string'?{[k]:v}:k;const p={};for(const x in ch)p[x]=o?.[x];record('update',{id,changes:ch,old:p})}return r}
store.delete=id=>{const o=base.get.call(store,id);const r=base.delete.call(store,id);r&&record('delete',{id,old:o});return r}
const sync={export:(s=0)=>({ops:exportOps(s),clock:clockSnap(),pid:cfg.pid,ts:Date.now()}),import:p=>p?.ops?(clockMerge(p.clock),{applied:importOps(p.ops)}):{applied:0},connect:(u=cfg.syncUrl)=>{if(!u||typeof WebSocket=='undefined')return null;const ws=new WebSocket(u);const q=[];let t=null;const flush=()=>{if(q.length&&ws.readyState==1)ws.send(JSON.stringify({type:'batch',ops:q}));q.length=0;t=null};ws.onopen=()=>ws.send(JSON.stringify({type:'hello',pid:cfg.pid,clock:clockSnap()}));ws.onmessage=e=>{try{const m=JSON.parse(e.data);m.ops&&sync.import(m)}catch{}};const off=onJournal(op=>{q.push(op);t||(t=setTimeout(flush,cfg.batchDelay))});return()=>{flush();off();ws.close()}}}
const onJournal=cb=>(listeners.add(cb),()=>listeners.delete(cb))
const queryJournal=(f={})=>log.filter(op=>!(f.pid&&op.pid!=f.pid)&&!(f.type&&op.type!=f.type)&&!(f.since&&op.ts<=f.since)&&!(f.before&&op.ts>=f.before))
const checkpoint=()=>record('checkpoint',{snapshot:[...store.dump()]})
const merge=(r,s='timestamp')=>{const t=r.dump?r.dump():r;let m=0,c=0;for(const[id,i]of t){const l=store.get(id);!l?(store.set(id,i),m++):s=='timestamp'?((i.modified||0)>(l.modified||0)?(store.set(id,i),m++):c++):0}return{m,c}}
class AffineOp{constructor(s=1,sh=0){this.s=s;this.sh=sh}compose(o){return new AffineOp(this.s*o.s,this.s*o.sh+this.sh)}apply(x){return this.s*x+this.sh}inverse(){return new AffineOp(1/this.s,-this.sh/this.s)}applyMany(a){const r=Array(a.length);for(let i=0;i<a.length;i++)r[i]=this.s*a[i]+this.sh;return r}}
return Object.assign(store,{sync,clock:{get:clockSnap,merge:clockMerge,current:()=>clock.get(cfg.pid)},journal:{on:onJournal,query:queryJournal,list:()=>[...log],size:()=>log.length,clear:()=>{log.length=0;logById.clear()}},merge,checkpoint,AffineOp,config:()=>({...cfg})})}
