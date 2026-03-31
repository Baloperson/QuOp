// QuOp.js benchmark suite
// usage:  node --expose-gc bench.js
// deps:   npm install lokijs lodash immutable rbush flatbush node-cache memory-cache quick-lru

import { createStore as createQuOp, where } from '../QuOp.js'


// ── optional libraries ────────────────────────────────────────────────────────
let Loki, lodash, immutable, RBush, Flatbush, NodeCache, MemoryCache, QuickLRU

try { Loki       = (await import('lokijs')).default;       console.log('✓ LokiJS') }      catch { console.log('– LokiJS not installed') }
try { lodash     = (await import('lodash')).default;       console.log('✓ Lodash') }       catch { console.log('– Lodash not installed') }
try { immutable  = (await import('immutable'));             console.log('✓ Immutable') }    catch { console.log('– Immutable not installed') }
try { RBush      = (await import('rbush')).default;        console.log('✓ RBush') }        catch { console.log('– RBush not installed') }
try { Flatbush   = (await import('flatbush')).default;     console.log('✓ Flatbush') }     catch { console.log('– Flatbush not installed') }
try { NodeCache  = (await import('node-cache')).default;   console.log('✓ NodeCache') }    catch { console.log('– NodeCache not installed') }
try { MemoryCache = (await import('memory-cache'));        console.log('✓ MemoryCache') }  catch { console.log('– MemoryCache not installed') }
try { QuickLRU   = (await import('quick-lru')).default;    console.log('✓ QuickLRU') }     catch { console.log('– QuickLRU not installed') }

// ── deterministic PRNG (mulberry32) ──────────────────────────────────────────
// Math.random() produces different sequences each run, making benchmark-to-benchmark
// comparisons noisy. This PRNG is seeded so every run gets identical operations.
function makePRNG(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ── harness ───────────────────────────────────────────────────────────────────
// WARMUP: fn() is called WARMUP times before any timing begins.
// This brings V8 to peak JIT for the specific call pattern being measured.
// Without it early timed runs pay interpretation overhead  
const WARMUP = 20
const RUNS   = 100   

function time(fn, rand) {
  const t = performance.now()
  fn(rand)
  return performance.now() - t
}

function median(arr) {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

function bench(fn, seed = 42) {
  // Warmup — not timed
  for (let w = 0; w < WARMUP; w++) fn(makePRNG(seed + w))
  // Timed — seeds continue past warmup range
  const times = Array.from({ length: RUNS }, (_, i) => time(fn, makePRNG(seed + WARMUP + i)))
  const med = median(times)
  return { ms: med, times }
}

// ── formatters ────────────────────────────────────────────────────────────────
const fmt    = n => n.toLocaleString()
const fmtMs  = ms => ms.toFixed(2) + 'ms'
const fmtB   = b => {
  if (!b) return '0 B'
  const u = ['B','KB','MB','GB'], i = Math.floor(Math.log(b) / Math.log(1024))
  return (b / 1024 ** i).toFixed(2) + ' ' + u[i]
}
const opsec  = (n, ms) => Math.round(n / (ms / 1000))
const pad    = (s, n) => String(s).padEnd(n)

// ── baseline stores ───────────────────────────────────────────────────────────
// Counter-based IDs instead of Date.now()+Math.random() so V8 sees stable
// string shapes and can specialise the Map.get hidden-class profile.
let _id = 0
const nextId = () => String(++_id)

class ArrayStore {
  constructor() { this.items = []; this.byId = new Map() }
  create(type, props = {}) {
    const id = props.id || nextId()
    const item = { id, type, ...props, created: Date.now() }
    this.items.push(item); this.byId.set(id, item); return item
  }
  get(id)        { return this.byId.get(id) ?? null }
  ref(id)        { return this.byId.get(id) ?? null }
  set(id, ch)    { const i = this.byId.get(id); if (i) Object.assign(i, ch, { modified: Date.now() }); return i ?? null }
  find(type, f)  { return this.items.filter(i => i.type === type && Object.entries(f ?? {}).every(([k,v]) => i[k] === v)) }
  delete(id)     { const i = this.byId.get(id); if (!i) return false; this.items = this.items.filter(x => x.id !== id); this.byId.delete(id); return true }
  clear()        { this.items = []; this.byId.clear() }
}

class ObjectStore {
  constructor() { this.items = {} }
  create(type, props = {}) {
    const id = props.id || nextId()
    this.items[id] = { id, type, ...props, created: Date.now() }; return this.items[id]
  }
  get(id)       { return this.items[id] ?? null }
  ref(id)       { return this.items[id] ?? null }
  set(id, ch)   { if (!this.items[id]) return null; Object.assign(this.items[id], ch, { modified: Date.now() }); return this.items[id] }
  find(type, f) { return Object.values(this.items).filter(i => i.type === type && Object.entries(f ?? {}).every(([k,v]) => i[k] === v)) }
  delete(id)    { if (!this.items[id]) return false; delete this.items[id]; return true }
  clear()       { this.items = {} }
}

// ── library wrappers ──────────────────────────────────────────────────────────

function buildLibraries() {
  const libs = new Map()

  // QuOp — two read paths tested separately
  libs.set('QuOp (safe get)', () => createQuOp())
  libs.set('QuOp (ref)',      () => createQuOp())

  libs.set('Array Store',  () => new ArrayStore())
  libs.set('Object Store', () => new ObjectStore())

  if (Loki) libs.set('LokiJS', () => {
    const db = new Loki('bench.db')
    const colls = {}
    const getOrAdd = t => colls[t] || (colls[t] = db.addCollection(t))
    const byId = new Map()
    return {
      create(type, props = {}) {
        const item = getOrAdd(type).insert({ ...props, type })
        item.id = String(item.$loki)
        byId.set(item.id, { coll: getOrAdd(type), loki: item.$loki })
        return item
      },
      get(id)     { const r = byId.get(id); return r ? r.coll.get(r.loki) : null },
      ref(id)     { const r = byId.get(id); return r ? r.coll.get(r.loki) : null },
      set(id, ch) {
        const r = byId.get(id); if (!r) return null
        const item = r.coll.get(r.loki); if (!item) return null
        Object.assign(item, ch); r.coll.update(item); return item
      },
      find(type, f) {
        const c = colls[type]; if (!c) return []
        return f ? c.find(f) : c.find()
      },
      delete(id) {
        const r = byId.get(id); if (!r) return false
        const item = r.coll.get(r.loki); if (!item) return false
        r.coll.remove(item); byId.delete(id); return true
      },
      clear() { Object.values(colls).forEach(c => db.removeCollection(c.name)); Object.keys(colls).forEach(k => delete colls[k]); byId.clear() }
    }
  })

  if (NodeCache) libs.set('NodeCache', () => {
    const cache = new NodeCache({ stdTTL: 0, checkperiod: 0 })
    const meta  = new Map()
    return {
      create(type, props = {}) {
        const id = props.id || nextId()
        const item = { id, type, ...props, created: Date.now() }
        meta.set(id, item); cache.set(id, item); return item
      },
      get(id)     { return cache.get(id) ?? null },
      ref(id)     { return meta.get(id) ?? null },
      set(id, ch) { const i = meta.get(id); if (!i) return null; Object.assign(i, ch, { modified: Date.now() }); cache.set(id, i); return i },
      find(type, f) { return [...meta.values()].filter(i => i.type === type && Object.entries(f ?? {}).every(([k,v]) => i[k] === v)) },
      delete(id)  { const ok = meta.delete(id); cache.del(id); return ok },
      clear()     { meta.clear(); cache.flushAll() }
    }
  })

  if (MemoryCache) libs.set('MemoryCache', () => {
    const cache = new MemoryCache.Cache()
    const meta  = new Map()
    return {
      create(type, props = {}) {
        const id = props.id || nextId()
        const item = { id, type, ...props, created: Date.now() }
        meta.set(id, item); cache.put(id, item); return item
      },
      get(id)     { return cache.get(id) ?? null },
      ref(id)     { return meta.get(id) ?? null },
      set(id, ch) { const i = meta.get(id); if (!i) return null; Object.assign(i, ch, { modified: Date.now() }); cache.put(id, i); return i },
      find(type, f) { return [...meta.values()].filter(i => i.type === type && Object.entries(f ?? {}).every(([k,v]) => i[k] === v)) },
      delete(id)  { const ok = meta.delete(id); cache.del(id); return ok },
      clear()     { meta.clear(); cache.clear() }
    }
  })

  if (QuickLRU) libs.set('QuickLRU', () => {
    const cache = new QuickLRU({ maxSize: 200000 })
    const meta  = new Map()
    return {
      create(type, props = {}) {
        const id = props.id || nextId()
        const item = { id, type, ...props, created: Date.now() }
        meta.set(id, item); cache.set(id, item); return item
      },
      get(id)     { return cache.get(id) ?? null },
      ref(id)     { return meta.get(id) ?? null },
      set(id, ch) { const i = meta.get(id); if (!i) return null; Object.assign(i, ch, { modified: Date.now() }); cache.set(id, i); return i },
      find(type, f) { return [...meta.values()].filter(i => i.type === type && Object.entries(f ?? {}).every(([k,v]) => i[k] === v)) },
      delete(id)  { const ok = meta.delete(id); cache.delete(id); return ok },
      clear()     { meta.clear(); cache.clear() }
    }
  })

  if (lodash) libs.set('Lodash', () => {
    const items = []; const byId = new Map()
    return {
      create(type, props = {}) {
        const id = props.id || nextId()
        const item = { id, type, ...props, created: Date.now() }
        items.push(item); byId.set(id, item); return item
      },
      get(id)     { return byId.get(id) ?? null },
      ref(id)     { return byId.get(id) ?? null },
      set(id, ch) { const i = byId.get(id); if (!i) return null; Object.assign(i, ch, { modified: Date.now() }); return i },
      find(type, f) { return lodash.filter(items, i => i.type === type && Object.entries(f ?? {}).every(([k,v]) => i[k] === v)) },
      delete(id)  {
        const idx = lodash.findIndex(items, { id })
        if (idx === -1) return false
        items.splice(idx, 1); byId.delete(id); return true
      },
      clear()     { items.length = 0; byId.clear() }
    }
  })

  if (immutable) libs.set('Immutable', () => {
    let map = immutable.Map()
    return {
      create(type, props = {}) {
        const id = props.id || nextId()
        const item = { id, type, ...props, created: Date.now() }
        map = map.set(id, item); return item
      },
      get(id)     { return map.get(id) ?? null },
      ref(id)     { return map.get(id) ?? null },
      set(id, ch) {
        const i = map.get(id); if (!i) return null
        const updated = { ...i, ...ch, modified: Date.now() }
        map = map.set(id, updated); return updated
      },
      find(type, f) {
        return map.valueSeq()
          .filter(i => i.type === type && Object.entries(f ?? {}).every(([k,v]) => i[k] === v))
          .toArray()
      },
      delete(id)  { if (!map.has(id)) return false; map = map.delete(id); return true },
      clear()     { map = immutable.Map() }
    }
  })

  return libs
}

// ── benchmark sections ────────────────────────────────────────────────────────

function benchCreate(libs) {
  console.log('\n CREATE PERFORMANCE (10,000 items)')
  console.log('-'.repeat(60))
  const N = 10_000
  for (const [name, factory] of libs) {
    try {
      const { ms } = bench(rand => {
        const store = factory()
        for (let i = 0; i < N; i++)
          store.create('test', { value: rand() * 1000 | 0, data: 'x'.repeat(20) })
      })
      console.log(`${pad(name, 22)}: ${fmtMs(ms)} total, ${fmt(opsec(N, ms))} ops/sec`)
    } catch (e) { console.log(`${pad(name, 22)}:  ${e.message}`) }
  }
}

function benchRead(libs) {
  console.log('\n READ PERFORMANCE (100,000 random reads)')
  console.log('-'.repeat(60))
  const N = 100_000
  for (const [name, factory] of libs) {
    try {
      const store = factory(); const ids = []
      for (let i = 0; i < 1000; i++) {
        const item = store.create('test', { value: i }); ids.push(item.id)
      }
      const useRef = name === 'QuOp (ref)'
      const { ms } = bench(rand => {
        for (let i = 0; i < N; i++) {
          const id = ids[rand() * ids.length | 0]
          useRef ? store.getRef(id) : store.get ? store.get(id) : store.ref(id)
        }
      })
      console.log(`${pad(name, 22)}: ${fmtMs(ms)} total, ${fmt(opsec(N, ms))} ops/sec`)
    } catch (e) { console.log(`${pad(name, 22)}:  ${e.message}`) }
  }
}

function benchUpdate(libs) {
  console.log('\n  UPDATE PERFORMANCE (50,000 updates)')
  console.log('-'.repeat(60))
  const N = 50_000
  for (const [name, factory] of libs) {
    try {
      const store = factory(); const ids = []
      for (let i = 0; i < 1000; i++) {
        const item = store.create('test', { value: i, counter: 0 }); ids.push(item.id)
      }
      const { ms } = bench(rand => {
        for (let i = 0; i < N; i++) {
          const id = ids[rand() * ids.length | 0]
          store.set ? store.set(id, { counter: rand() * 1000 | 0 })
                    : store.update(id, { counter: rand() * 1000 | 0 })
        }
      })
      console.log(`${pad(name, 22)}: ${fmtMs(ms)} total, ${fmt(opsec(N, ms))} ops/sec`)
    } catch (e) { console.log(`${pad(name, 22)}:  ${e.message}`) }
  }
}

function benchQuery(libs) {
  console.log('\n QUERY PERFORMANCE (simple vs complex, avg over 100 queries)')
  console.log('-'.repeat(60))
  for (const [name, factory] of libs) {
    try {
      const store = factory()
      // Deterministic setup — score via PRNG not Math.random()
      const setupRand = makePRNG(999)
      for (let i = 0; i < 10_000; i++)
        store.create('test', { value: i, category: i % 10, active: i % 2 === 0, score: setupRand() * 100 })

      const isQuOp = name.includes('QuOp')
      const isLoki    = name === 'LokiJS'

      
      const simplePred  = isQuOp ? where.and(where.eq('category', 5), where.eq('active', true)) : null
      const complexPred = isQuOp ? where.and(where.gt('value', 5000), where.in('category', [2,4,6,8]), where.eq('active', true)) : null

      const { ms: sMs } = bench(() => {
        for (let i = 0; i < 100; i++) {
          if (isQuOp) store.find('test', simplePred)
          else store.find('test', { category: 5, active: true })
        }
      })

      let cStr = 'N/A'
      if (isQuOp || isLoki) {
        const { ms: cMs } = bench(() => {
          for (let i = 0; i < 100; i++) {
            if (isQuOp)
              store.find('test', complexPred)
            else
              store.find('test', { value: { $gt: 5000 }, category: { $in: [2,4,6,8] }, active: true })
          }
        })
        cStr = fmtMs(cMs / 100)
      }

      console.log(`${pad(name, 22)}: simple ${fmtMs(sMs / 100)}, complex ${cStr}`)
    } catch (e) { console.log(`${pad(name, 22)}: ❌ ${e.message}`) }
  }
}

function benchMixed(libs) {
  console.log('\nMIXED WORKLOAD (10,000 operations)')
  console.log('    40% read  20% update  20% simple find  20% complex find')
  console.log('-'.repeat(60))
  const N = 10_000
  for (const [name, factory] of libs) {
    try {
      const store = factory(); const ids = []
      for (let i = 0; i < 1000; i++) {
        const item = store.create('test', {
          value: i, category: i % 10, active: i % 2 === 0, score: i / 10
        })
        ids.push(item.id)
      }
      const isQuOp = name.includes('QuOp')
      const isLoki    = name === 'LokiJS'
      const useRef    = name === 'QuOp (ref)'

      
      const simplePred  = isQuOp ? where.eq('category', 5) : null
      const complexPred = isQuOp ? where.and(where.gt('value', 500), where.eq('active', true)) : null

      const { ms } = bench(rand => {
        for (let i = 0; i < N; i++) {
          const r = rand()
          if (r < 0.4) {
            const id = ids[rand() * ids.length | 0]
            useRef ? store.getRef(id) : store.get ? store.get(id) : store.ref(id)
          } else if (r < 0.6) {
            const id = ids[rand() * ids.length | 0]
            store.set ? store.set(id, { value: rand() * 1000 | 0 })
                      : store.update(id, { value: rand() * 1000 | 0 })
          } else if (r < 0.8) {
            const cat = rand() * 10 | 0
            if (isQuOp) store.find('test', simplePred)
            else store.find('test', { category: cat })
          } else {
            if (isQuOp)
              store.find('test', complexPred)
            else if (isLoki)
              store.find('test', { value: { $gt: 500 }, active: true })
            else
              store.find('test', { value: 500 })
          }
        }
      })
      console.log(`${pad(name, 22)}: ${fmtMs(ms)} total, ${fmt(opsec(N, ms))} ops/sec`)
    } catch (e) { console.log(`${pad(name, 22)}:  ${e.message}`) }
  }
}

async function benchMemory(libs) {
  console.log('\n MEMORY USAGE (per 10,000 items)')
  console.log('-'.repeat(60))
  if (!global.gc) {
    console.log('   run with --expose-gc for memory metrics'); return
  }
  for (const [name, factory] of libs) {
    try {
      for (let i = 0; i < 3; i++) { global.gc(); await new Promise(r => setTimeout(r, 50)) }
      const before = process.memoryUsage().heapUsed
      const store = factory(); const refs = []
      for (let i = 0; i < 10_000; i++) {
        refs.push(store.create('test', {
          value: i, category: `cat-${i % 50}`, active: i % 2 === 0,
          tags: ['a','b','c'], metadata: { created: Date.now(), score: Math.random() * 100 },
          data: 'x'.repeat(100)
        }))
      }
      for (let i = 0; i < 3; i++) { global.gc(); await new Promise(r => setTimeout(r, 50)) }
      const used = Math.max(0, process.memoryUsage().heapUsed - before)
      console.log(`${pad(name, 22)}: ${fmtB(used)} total, ${fmtB(used / 10_000)} per item`)
      refs.length = 0; store.clear?.()
    } catch (e) { console.log(`${pad(name, 22)}:  ${e.message}`) }
  }
}

async function benchSpatial() {
  console.log('\n  SPATIAL QUERY PERFORMANCE (avg over 100 queries, 10,000 points)')
  console.log('-'.repeat(60))

  const ts = createQuOp()
  const rand = makePRNG(1)
  for (let i = 0; i < 10_000; i++)
    ts.create('pt', { x: rand() * 1000, y: rand() * 1000, value: i })


  const filteredPred = where.gt('value', 5000)

  const { ms: tsMs }  = bench(() => { for (let i = 0; i < 100; i++) ts.near('pt', 500, 500, 100).all() })
  const { ms: tsFMs } = bench(() => { for (let i = 0; i < 100; i++) ts.near('pt', 500, 500, 100, filteredPred).all() })
  console.log(`${pad('QuOp Spatial', 28)}: ${(tsMs/100).toFixed(3)}ms avg`)
  console.log(`${pad('QuOp Spatial (filtered)', 28)}: ${(tsFMs/100).toFixed(3)}ms avg`)

  if (RBush) {
    const tree = new RBush(); const pts = []
    const r2 = makePRNG(1)
    for (let i = 0; i < 10_000; i++) {
      const x = r2() * 1000, y = r2() * 1000
      pts.push({ minX:x, minY:y, maxX:x, maxY:y, value:i })
    }
    tree.load(pts)
    const { ms } = bench(() => { for (let i = 0; i < 100; i++) tree.search({ minX:400, minY:400, maxX:600, maxY:600 }) })
    console.log(`${pad('RBush', 28)}: ${(ms/100).toFixed(3)}ms avg`)
  }

  if (Flatbush) {
    const idx = new Flatbush(10_000); const r3 = makePRNG(1)
    for (let i = 0; i < 10_000; i++) { const x = r3() * 1000, y = r3() * 1000; idx.add(x,y,x,y) }
    idx.finish()
    const { ms } = bench(() => { for (let i = 0; i < 100; i++) { const out=[]; idx.search(400,400,600,600,i=>out.push(i)) } })
    console.log(`${pad('Flatbush', 28)}: ${(ms/100).toFixed(3)}ms avg`)
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

console.log('='.repeat(70))
console.log(' QuOp.JS BENCHMARK ')
console.log('='.repeat(70))
console.log(`Node ${process.version} | ${new Date().toLocaleTimeString()} | ${WARMUP} warmup + ${RUNS} timed runs, reporting median`)
if (!global.gc) console.log('⚠  run with --expose-gc for memory metrics')
console.log()

const libs = buildLibraries()
console.log(`\n${libs.size} libraries loaded\n`)

benchCreate(libs)
benchRead(libs)
benchUpdate(libs)
benchQuery(libs)
benchMixed(libs)
await benchMemory(libs)
await benchSpatial()

console.log('\n' + '='.repeat(70))
console.log(' DONE')
console.log('='.repeat(70))
