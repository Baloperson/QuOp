// bench.plus.js — QuOp+ distributed benchmark suite 
// usage: node --expose-gc bench.plus.js

import { createStore }                    from '../QuOp.plus.js'
import { createStore as base, where }     from '../QuOp.js'
import os from 'os'

const WARMUP = 0
const RUNS   = 1 

const fmt  = n  => Math.round(n).toLocaleString()
const fmtB = b  => { if(!b) return '0 B'; const u=['B','KB','MB','GB'],i=Math.floor(Math.log(b)/Math.log(1024)); return (b/1024**i).toFixed(2)+' '+u[i] }
const wait = ms => new Promise(r => setTimeout(r, ms))

const median = arr => {
  const s = [...arr].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

// Deterministic PRNG 
function makePRNG(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// Time a single run with given PRNG
function time(fn, rand) {
  const t = performance.now()
  fn(rand)
  return performance.now() - t
}


async function bench(fn, seed = 42) {
  // Warmup — not timed, separate seeds
  for (let w = 0; w < WARMUP; w++) {
    await fn(makePRNG(seed + w))
  }
  
  // Timed runs — seeds continue past warmup
  const times = []
  for (let i = 0; i < RUNS; i++) {
    const t = await time(async (rand) => {
      await fn(rand)
    }, makePRNG(seed + WARMUP + i))
    times.push(t)
  }
  
  const med = median(times)
  return { ms: med, times }
}

// ── WebSocket mock ──────────────────────────────────────────────
class MockWS {
  static buses = new Map()
  constructor(url) {
    this.url = url; this.readyState = 0
    this.onopen = this.onmessage = this.onclose = null
    if(!MockWS.buses.has(url)) MockWS.buses.set(url, new Set())
    this._bus = MockWS.buses.get(url)
    setTimeout(() => { this.readyState = 1; this._bus.add(this); this.onopen?.() }, 5)
  }
  send(d) {
    if(this.readyState !== 1) return
    try {
      const msg = JSON.parse(d)
      const fwd = msg.type === 'batch'
        ? msg.ops.map(op => JSON.stringify(op))
        : [d]
      for(const f of fwd)
        for(const c of this._bus)
          if(c !== this && c.readyState === 1) c.onmessage?.({ data: f })
    } catch {}
  }
  close() {
    this.readyState = 3; this._bus.delete(this); this.onclose?.()
  }
}
global.WebSocket = MockWS

// ── journal  ───────────────────────────────────
async function benchJournal() {
  console.log('\n JOURNAL PERFORMANCE')
  console.log('-'.repeat(60))

  // Write speed test
  const N = 100_000
  const { ms: tWrite } = await bench(async (rand) => {
    const store = createStore({ processId: 'j1' })
    // Use PRNG for deterministic data
    for(let i=0;i<N;i++) 
      store.create('item', { 
        value: Math.floor(rand() * 1000000),
        data: 'x'.repeat(50) 
      })
  })
  
  console.log(`Journal writes (${fmt(N)} ops):`)
  console.log(`  Time:  ${tWrite.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(N/(tWrite/1000))} ops/sec`)
  
  // Get final size from a separate instance to avoid interference
  const sizeStore = createStore({ processId: 'j1-size' })
  for(let i=0;i<N;i++) sizeStore.create('item', { value: i })
  console.log(`  Journal size: ${fmt(sizeStore.journal.size())} entries`)

  // Query performance
  console.log('\nJournal query performance (avg per query):')
  
  const queryTypes = [
    ['byTime',    { since: Date.now() - 60000 }],
    ['byProcess', { pid: 'j1' }],
    ['byType',    { type: 'create' }],
  ]
  
  for (const [label, filter] of queryTypes) {
    const { ms: totalMs } = await bench(async () => {
      // Fresh store with known data
      const store = createStore({ processId: 'j1' })
      for(let i=0;i<10000;i++) store.create('item', { value: i })
      
      // Run 100 queries per timed iteration for better resolution
      for(let q=0; q<100; q++) {
        store.journal.query(filter)
      }
    })
    
    // Adjust for 100 queries per run
    const perQuery = totalMs / 100
    console.log(`  ${label.padEnd(12)}: ${perQuery.toFixed(3)}ms`)
  }

  // Checkpoint performance
  const { ms: tCp } = await bench(async () => {
    const store = createStore({ processId: 'j1-cp' })
    for(let i=0;i<N;i++) store.create('item', { value: i })
    store.checkpoint()
  })
  
  console.log(`\nCheckpoint:`)
  console.log(`  Time: ${tCp.toFixed(2)}ms`)
  
  // Final size (for info)
  const cpStore = createStore({ processId: 'j1-cp-size' })
  for(let i=0;i<N;i++) cpStore.create('item', { value: i })
  cpStore.checkpoint()
  console.log(`  Journal after: ${fmt(cpStore.journal.size())} entries`)
}

// ── vector clocks ────────────────────────────
async function benchClocks() {
  console.log('\n VECTOR CLOCK PERFORMANCE')
  console.log('-'.repeat(60))
  console.log('Note: clock increments happen automatically on store operations\n')

  const N = 100_000
  const M = 1_000_000

  // Create ops — each records a journal entry which increments the clock
  const { ms: tCreate } = await bench(async (rand) => {
    const store = createStore({ processId: 'c1' })
    for(let i=0;i<N;i++) 
      store.create('item', { value: Math.floor(rand() * 1000000) })
  })
  
  console.log(`Create ops (implicit clock inc) (${fmt(N)} ops):`)
  console.log(`  Time:  ${tCreate.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(N/(tCreate/1000))} ops/sec`)
  
  // Get final clock from a separate instance
  const clockStore = createStore({ processId: 'c1-final' })
  for(let i=0;i<N;i++) clockStore.create('item', { value: i })
  console.log(`  Final clock: ${clockStore.clock.current()}`)

  // Clock snapshot
  const { ms: tSnap } = await bench(() => {
    const store = createStore({ processId: 'c2' })
    // Pre-create some items to have clock state
    for(let i=0;i<1000;i++) store.create('item', { value: i })
    
    const t = performance.now()
    for(let i=0;i<N;i++) store.clock.get()
    return performance.now() - t
  })
  
  console.log(`\nClock snapshots (${fmt(N)} ops):`)
  console.log(`  Time:  ${tSnap.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(N/(tSnap/1000))} ops/sec`)

  // Clock merge
  const { ms: tMerge } = await bench(() => {
    const store = createStore({ processId: 'c3' })
    const other = { 'c2': 5000, 'c3': 3000, 'c4': 1000 }
    
    const t = performance.now()
    for(let i=0;i<N;i++) store.clock.merge(other)
    return performance.now() - t
  })
  
  console.log(`\nClock merges (${fmt(N)} ops):`)
  console.log(`  Time:  ${tMerge.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(N/(tMerge/1000))} ops/sec`)

  // Clock current — read local counter only
  const { ms: tCurrent } = await bench(() => {
    const store = createStore({ processId: 'c4' })
    // Pre-create items to have state
    for(let i=0;i<1000;i++) store.create('item', { value: i })
    
    const t = performance.now()
    for(let i=0;i<M;i++) store.clock.current()
    return performance.now() - t
  })
  
  console.log(`\nClock current (${fmt(M)} ops):`)
  console.log(`  Time:  ${tCurrent.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(M/(tCurrent/1000))} ops/sec`)
}

async function benchSync() {
  console.log('\n SYNC PERFORMANCE')
  console.log('-'.repeat(60))

  const opCount = 1000
  
  // Operation propagation
  const { ms: tGen } = await bench(async (rand) => {
    MockWS.buses.clear()
    
    const s1 = createStore({ processId: 'node-1', batchDelay: 0 })
    const s2 = createStore({ processId: 'node-2', batchDelay: 0 })
    
    const dc1 = s1.sync.connect('ws://bench-sync')
    const dc2 = s2.sync.connect('ws://bench-sync')
    await wait(50)  // let connections open
    
    for(let i=0;i<opCount;i++) 
      s1.create('item', { value: Math.floor(rand() * 1000000) })
    
    dc1?.(); dc2?.()
  })
  
  console.log(`\nOperation propagation (${fmt(opCount)} ops):`)
  console.log(`  Time: ${tGen.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(opCount/(tGen/1000))} ops/sec`)
  console.log(`  Avg latency: 0.00ms (in-process mock, no network)`)

  // Export performance
  const { ms: tExport } = await bench(() => {
    const store = createStore({ processId: 'node-export' })
    // Pre-create items to have exportable state
    for(let i=0;i<1000;i++) store.create('item', { value: i })
    
    const t = performance.now()
    for(let i=0;i<1000;i++) store.sync.export(0)
    return performance.now() - t
  })
  
  console.log(`\nExport operations (1,000 ops):`)
  console.log(`  Time:  ${tExport.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(1000/(tExport/1000))} ops/sec`)

  // Import performance
  const { ms: tImport } = await bench(() => {
    const source = createStore({ processId: 'node-source' })
    for(let i=0;i<1000;i++) source.create('item', { value: i })
    const payload = source.sync.export(0)
    
    const dest = createStore({ processId: 'node-dest' })
    const t = performance.now()
    for(let i=0;i<100;i++) dest.sync.import(payload)
    return performance.now() - t
  })
  
  console.log(`\nImport operations (100 ops):`)
  console.log(`  Time:  ${tImport.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(100/(tImport/1000))} ops/sec`)
}

async function benchMerge() {
  console.log('\n MERGE STRATEGIES (with real conflicts)')
  console.log('-'.repeat(60))

  const base_ts = Date.now()

  const strategies = [
    ['ours', (s1, s2, id, item, ex) => {
      if(!ex) { s1.create(item.type, item); return 'merged' }
      return 'conflict'
    }],
    ['theirs', (s1, s2, id, item, ex) => {
      if(!ex) { s1.create(item.type, item); return 'merged' }
      else { s1.update(id, item); return 'merged' }
    }],
    ['timestamp', (s1, s2, id, item, ex) => {
      if(!ex) { s1.create(item.type, item); return 'merged' }
      else if((item.modified||0) > (ex.modified||0)) { 
        s1.update(id, item); return 'merged' 
      }
      return 'conflict'
    }]
  ]

  for (const [name, mergeFn] of strategies) {
    const { ms: tMerge } = await bench(() => {
      // Build fresh stores each run
      const s1 = createStore({ processId: 'n1' })
      const s2 = createStore({ processId: 'n2' })
      
      // Common base items
      for(let i=0;i<1000;i++) {
        const props = { value:i, modified: base_ts - 10000 }
        s1.create('item', { id:`item-${i}`, ...props })
        s2.create('item', { id:`item-${i}`, ...props })
      }
      
      // Conflicting updates
      for(let i=0;i<500;i++) {
        s1.update(`item-${i}`, { value:i*2, owner:'n1', modified: base_ts - 5000 })
        s2.update(`item-${i}`, { value:i*3, owner:'n2', modified: base_ts })
      }
      
      // Unique items
      for(let i=1000;i<1500;i++) s1.create('item', { value:i, owner:'n1' })
      for(let i=1500;i<2000;i++) s2.create('item', { value:i, owner:'n2' })
      
      // Perform merge and count
      let merged = 0, conflicts = 0
      for(const [id, item] of Object.entries(s2.dump())) {
        const ex = s1.get(id)
        const result = mergeFn(s1, s2, id, item, ex)
        if(result === 'merged') merged++
        else conflicts++
      }
    })
    
    // Run once to get counts (deterministic, same every time)
    const s1 = createStore({ processId: 'n1' })
    const s2 = createStore({ processId: 'n2' })
    for(let i=0;i<1000;i++) {
      const props = { value:i, modified: base_ts - 10000 }
      s1.create('item', { id:`item-${i}`, ...props })
      s2.create('item', { id:`item-${i}`, ...props })
    }
    for(let i=0;i<500;i++) {
      s1.update(`item-${i}`, { value:i*2, owner:'n1', modified: base_ts - 5000 })
      s2.update(`item-${i}`, { value:i*3, owner:'n2', modified: base_ts })
    }
    for(let i=1000;i<1500;i++) s1.create('item', { value:i, owner:'n1' })
    for(let i=1500;i<2000;i++) s2.create('item', { value:i, owner:'n2' })
    
    let merged = 0, conflicts = 0
    for(const [id, item] of Object.entries(s2.dump())) {
      const ex = s1.get(id)
      if(!ex) { s1.create(item.type, item); merged++ }
      else if(name === 'theirs') { s1.update(id, item); merged++ }
      else if(name === 'timestamp' && (item.modified||0) > (ex.modified||0)) { 
        s1.update(id, item); merged++ 
      }
      else conflicts++
    }
    
    console.log(`${name.padEnd(10)}: ${tMerge.toFixed(2)}ms, merged ${merged}, conflicts ${conflicts}`)
  }
}

async function benchAffine() {
  console.log('\n AFFINE OPERATIONS')
  console.log('-'.repeat(60))

  const { AffineOp } = createStore()
  const arr = Array.from({ length: 10_000 }, (_,i) => i)

  // Single apply
  const { ms: tApply } = await bench(() => {
    const op = new AffineOp(2, 5)
    const t = performance.now()
    for(let i=0;i<1_000_000;i++) op.apply(i)
    return performance.now() - t
  })
  
  console.log(`Single apply (1,000,000 ops):`)
  console.log(`  Time:  ${tApply.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(1_000_000/(tApply/1000))} ops/sec`)

  // Batch apply
  const { ms: tBatch } = await bench(() => {
    const op = new AffineOp(2, 5)
    const t = performance.now()
    for(let i=0;i<1000;i++) op.applyMany(arr)
    return performance.now() - t
  })
  
  console.log(`\nBatch apply (1,000 batches of 10,000):`)
  console.log(`  Time:  ${tBatch.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(10_000_000/(tBatch/1000))} items/sec`)

  // Compose
  const { ms: tCompose } = await bench(() => {
    const op1 = new AffineOp(2, 5)
    const op2 = new AffineOp(3, 1)
    const t = performance.now()
    for(let i=0;i<100_000;i++) op1.compose(op2)
    return performance.now() - t
  })
  
  console.log(`\nCompose (100,000 ops):`)
  console.log(`  Time:  ${tCompose.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(100_000/(tCompose/1000))} ops/sec`)

  // Inverse
  const { ms: tInv } = await bench(() => {
    const op = new AffineOp(2, 5)
    const t = performance.now()
    for(let i=0;i<100_000;i++) op.inverse()
    return performance.now() - t
  })
  
  console.log(`\nInverse (100,000 ops):`)
  console.log(`  Time:  ${tInv.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(100_000/(tInv/1000))} ops/sec`)
}

// ── memory overhead ────────────────────────────
async function benchMemory() {
  console.log('\n MEMORY OVERHEAD')
  console.log('-'.repeat(60))

  if(!global.gc) { console.log('   run with --expose-gc for memory metrics'); return }

  const gc3 = async () => { for(let i=0;i<5;i++) { global.gc(); await wait(200) } }

  const measureStore = async (factory) => {
    for(let attempt=0;attempt<2;attempt++) { await gc3() }
    const m0 = process.memoryUsage().heapUsed
    const store = factory()
    const refs = []
    for(let i=0;i<10_000;i++) refs.push(store.create('item', { value:i, data:'x'.repeat(100), tags:['a','b','c'] }))
    for(let attempt=0;attempt<2;attempt++) { await gc3() }
    const mem = Math.max(0, process.memoryUsage().heapUsed - m0)
    void refs
    return { store, mem }
  }

  const { mem: baseMem } = await measureStore(() => base())
  const { store: plusStore, mem: plusMem } = await measureStore(() => createStore({ processId: 'mem-test' }))

  console.log(`Base QuOp (10k items):`)
  console.log(`  Total:    ${fmtB(baseMem)}`)
  console.log(`  Per item: ${fmtB(baseMem/10_000)}`)
  console.log(`\nQuOp+ (10k items):`)
  console.log(`  Total:    ${fmtB(plusMem)}`)
  console.log(`  Per item: ${fmtB(plusMem/10_000)}`)
  console.log(`  Overhead: ${fmtB(plusMem-baseMem)} (${((plusMem-baseMem)/baseMem*100).toFixed(1)}%)`)
  console.log(`  Journal entries: ${fmt(plusStore.journal.size())}`)
}

// ── main ───────────────────────────────────────────────────────────────────────
console.log('='.repeat(70))
console.log(' QuOp+ DISTRIBUTED BENCHMARK SUITE ')
console.log('='.repeat(70))
console.log(`Node ${process.version} | ${new Date().toLocaleTimeString()} | ${WARMUP} warmup + ${RUNS} timed runs, reporting median`)
console.log(`CPU: ${os.cpus()[0].model}`)
console.log(`Memory: ${fmtB(os.totalmem())}`)
if(!global.gc) console.log('  run with --expose-gc for memory metrics')

await benchJournal()
await benchClocks()
await benchSync()
await benchMerge()
await benchAffine()
await benchMemory()

console.log('\n' + '='.repeat(70))
console.log(' DONE')
console.log('='.repeat(70))
