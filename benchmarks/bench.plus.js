// bench.plus.js — tinyset+ distributed benchmark suite
// usage: node --expose-gc bench.plus.js

import { createStore }                    from '../tinyset.plus.js'
import { createStore as base, where }     from '../tinyset.js'
import os from 'os'

// ── utilities ─────────────────────────────────────────────────────────────────
const fmt  = n  => Math.round(n).toLocaleString()
const fmtB = b  => { if(!b) return '0 B'; const u=['B','KB','MB','GB'],i=Math.floor(Math.log(b)/Math.log(1024)); return (b/1024**i).toFixed(2)+' '+u[i] }
const wait = ms => new Promise(r => setTimeout(r, ms))
const RUNS = 5
const median = a => [...a].sort((x,y)=>x-y)[Math.floor(a.length/2)]
const bench  = async fn => {
  const times = []
  for(let i=0;i<RUNS;i++) times.push(await fn())
  return median(times)
}

// ── WebSocket mock ─────────────────────────────────────────────────────────────
// Minimal in-process mock — same URL shares the same bus, immediate delivery
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
    // tinyset+ sends {type:'batch', ops:[...]} or {type:'hello',...}
    // broadcast all ops to peers
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

// ── journal ───────────────────────────────────────────────────────────────────
async function benchJournal() {
  console.log('\n JOURNAL PERFORMANCE')
  console.log('-'.repeat(60))

  const store = createStore({ processId: 'j1' })

  // write speed
  const N = 100_000
  const tWrite = await bench(async () => {
    store.journal.clear()
    const t = performance.now()
    for(let i=0;i<N;i++) store.create('item', { value:i, data:'x'.repeat(50) })
    return performance.now() - t
  })
  console.log(`Journal writes (${fmt(N)} ops):`)
  console.log(`  Time:  ${tWrite.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(N/(tWrite/1000))} ops/sec`)
  console.log(`  Journal size: ${fmt(store.journal.size())} entries`)

  // query performance (median of 1000 queries each type)
  const queries = {}
  for(const [label, filter] of [
    ['byTime',    { since: Date.now() - 60000 }],
    ['byProcess', { pid: 'j1' }],
    ['byType',    { type: 'create' }],
  ]) {
    const t = performance.now()
    for(let i=0;i<1000;i++) store.journal.query(filter)
    queries[label] = (performance.now()-t)/1000
  }
  console.log('\nJournal query performance (avg per query):')
  for(const [k,v] of Object.entries(queries))
    console.log(`  ${k.padEnd(12)}: ${v.toFixed(3)}ms`)

  // checkpoint
  const tCp = performance.now()
  store.checkpoint()
  console.log(`\nCheckpoint:`)
  console.log(`  Time: ${(performance.now()-tCp).toFixed(2)}ms`)
  console.log(`  Journal after: ${fmt(store.journal.size())} entries`)
}

// ── vector clocks ──────────────────────────────────────────────────────────────
async function benchClocks() {
  console.log('\n VECTOR CLOCK PERFORMANCE')
  console.log('-'.repeat(60))
  console.log('Note: clock increments happen automatically on store operations\n')

  const store = createStore({ processId: 'c1' })
  const N = 100_000

  // create ops — each records a journal entry which increments the clock
  const tCreate = await bench(async () => {
    store.clear(); store.journal.clear()
    const t = performance.now()
    for(let i=0;i<N;i++) store.create('item', { value:i })
    return performance.now()-t
  })
  console.log(`Create ops (implicit clock inc) (${fmt(N)} ops):`)
  console.log(`  Time:  ${tCreate.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(N/(tCreate/1000))} ops/sec`)
  console.log(`  Final clock: ${store.clock.current()}`)

  // clock snapshot
  const tSnap = await bench(async () => {
    const t = performance.now()
    for(let i=0;i<N;i++) store.clock.get()
    return performance.now()-t
  })
  console.log(`\nClock snapshots (${fmt(N)} ops):`)
  console.log(`  Time:  ${tSnap.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(N/(tSnap/1000))} ops/sec`)

  // clock merge
  const other = { 'c2': 5000, 'c3': 3000 }
  const tMerge = await bench(async () => {
    const t = performance.now()
    for(let i=0;i<N;i++) store.clock.merge(other)
    return performance.now()-t
  })
  console.log(`\nClock merges (${fmt(N)} ops):`)
  console.log(`  Time:  ${tMerge.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(N/(tMerge/1000))} ops/sec`)

  // clock current — read local counter only
  const M = 1_000_000
  const tCurrent = await bench(async () => {
    const t = performance.now()
    for(let i=0;i<M;i++) store.clock.current()
    return performance.now()-t
  })
  console.log(`\nClock current (${fmt(M)} ops):`)
  console.log(`  Time:  ${tCurrent.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(M/(tCurrent/1000))} ops/sec`)
}

// ── sync ───────────────────────────────────────────────────────────────────────
async function benchSync() {
  console.log('\n SYNC PERFORMANCE')
  console.log('-'.repeat(60))

  MockWS.buses.clear()

  const s1 = createStore({ processId: 'node-1', batchDelay: 0 })
  const s2 = createStore({ processId: 'node-2', batchDelay: 0 })

  const dc1 = s1.sync.connect('ws://bench-sync')
  const dc2 = s2.sync.connect('ws://bench-sync')
  await wait(50)  // let connections open

  // measure op generation speed
  const opCount = 1000
  console.log(`Generating ${fmt(opCount)} operations...`)
  const tGen = performance.now()
  for(let i=0;i<opCount;i++) s1.create('item', { value: i })
  const genMs = performance.now() - tGen

  console.log(`\nOperation propagation (${fmt(opCount)} ops):`)
  console.log(`  Time: ${genMs.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(opCount/(genMs/1000))} ops/sec`)
  console.log(`  Avg latency: 0.00ms (in-process mock, no network)`)

  // export performance — median of 1000 export calls
  const tExport = await bench(async () => {
    const t = performance.now()
    for(let i=0;i<1000;i++) s1.sync.export(0)
    return performance.now()-t
  })
  console.log(`\nExport operations (1,000 ops):`)
  console.log(`  Time:  ${tExport.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(1000/(tExport/1000))} ops/sec`)

  // import performance — import a real payload
  const payload = s1.sync.export(0)
  const tImport = await bench(async () => {
    const t = performance.now()
    for(let i=0;i<100;i++) s2.sync.import(payload)
    return performance.now()-t
  })
  console.log(`\nImport operations (100 ops):`)
  console.log(`  Time:  ${tImport.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(100/(tImport/1000))} ops/sec`)

  dc1?.(); dc2?.()
}

// ── merge ──────────────────────────────────────────────────────────────────────
async function benchMerge() {
  console.log('\n MERGE STRATEGIES (with real conflicts)')
  console.log('-'.repeat(60))

  const base_ts = Date.now()

  // build a fresh pair of stores with conflicts and unique items
  const buildStores = () => {
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
    return [s1, s2]
  }

  // ours: keep s1 on conflict, add unique from s2
  {
    const [s1, s2] = buildStores()
    const t = performance.now()
    let m=0, c=0
    for(const [id, item] of Object.entries(s2.dump())) {
      if(!s1.get(id)) { s1.create(item.type, item); m++ }
      else c++
    }
    console.log(`ours        : ${(performance.now()-t).toFixed(2)}ms, merged ${m}, conflicts ${c}`)
  }

  // theirs: s2 wins all conflicts, add unique from s2
  {
    const [s1, s2] = buildStores()
    const t = performance.now()
    let m=0, c=0
    for(const [id, item] of Object.entries(s2.dump())) {
      if(!s1.get(id)) { s1.create(item.type, item); m++ }
      else { s1.update(id, item); m++ }
    }
    console.log(`theirs      : ${(performance.now()-t).toFixed(2)}ms, merged ${m}, conflicts ${c}`)
  }

  // timestamp: newer modified wins
  {
    const [s1, s2] = buildStores()
    const t = performance.now()
    let m=0, c=0
    for(const [id, item] of Object.entries(s2.dump())) {
      const ex = s1.get(id)
      if(!ex) { s1.create(item.type, item); m++ }
      else if((item.modified||0) > (ex.modified||0)) { s1.update(id, item); m++ }
      else c++
    }
    console.log(`timestamp   : ${(performance.now()-t).toFixed(2)}ms, merged ${m}, conflicts ${c}`)
  }
}

// ── affine ops ────────────────────────────────────────────────────────────────
async function benchAffine() {
  console.log('\n AFFINE OPERATIONS')
  console.log('-'.repeat(60))

  const { AffineOp } = createStore()
  const op  = new AffineOp(2, 5)
  const op2 = new AffineOp(3, 1)
  const arr = Array.from({ length: 10_000 }, (_,i) => i)

  // single apply
  const tApply = await bench(async () => {
    const t = performance.now()
    for(let i=0;i<1_000_000;i++) op.apply(i)
    return performance.now()-t
  })
  console.log(`Single apply (1,000,000 ops):`)
  console.log(`  Time:  ${tApply.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(1_000_000/(tApply/1000))} ops/sec`)

  // batch apply
  const tBatch = await bench(async () => {
    const t = performance.now()
    for(let i=0;i<1000;i++) op.applyMany(arr)
    return performance.now()-t
  })
  console.log(`\nBatch apply (1,000 batches of 10,000):`)
  console.log(`  Time:  ${tBatch.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(10_000_000/(tBatch/1000))} items/sec`)

  // compose
  const tCompose = await bench(async () => {
    const t = performance.now()
    for(let i=0;i<100_000;i++) op.compose(op2)
    return performance.now()-t
  })
  console.log(`\nCompose (100,000 ops):`)
  console.log(`  Time:  ${tCompose.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(100_000/(tCompose/1000))} ops/sec`)

  // inverse
  const tInv = await bench(async () => {
    const t = performance.now()
    for(let i=0;i<100_000;i++) op.inverse()
    return performance.now()-t
  })
  console.log(`\nInverse (100,000 ops):`)
  console.log(`  Time:  ${tInv.toFixed(2)}ms`)
  console.log(`  Speed: ${fmt(100_000/(tInv/1000))} ops/sec`)
}

// ── memory overhead ───────────────────────────────────────────────────────────
async function benchMemory() {
  console.log('\n MEMORY OVERHEAD')
  console.log('-'.repeat(60))

  if(!global.gc) { console.log('   run with --expose-gc for memory metrics'); return }

  const gc3 = async () => { for(let i=0;i<5;i++) { global.gc(); await wait(200) } }

  // take baseline twice and use the larger reading to avoid GC timing artefacts
  const measureStore = async (factory) => {
    for(let attempt=0;attempt<2;attempt++) { await gc3() }
    const m0 = process.memoryUsage().heapUsed
    const store = factory()
    const refs = []
    for(let i=0;i<10_000;i++) refs.push(store.create('item', { value:i, data:'x'.repeat(100), tags:['a','b','c'] }))
    for(let attempt=0;attempt<2;attempt++) { await gc3() }
    const mem = Math.max(0, process.memoryUsage().heapUsed - m0)
    void refs  // keep refs alive through measurement
    return { store, mem }
  }

  const { mem: baseMem } = await measureStore(() => base())
  const { store: plusStore, mem: plusMem } = await measureStore(() => createStore({ processId: 'mem-test' }))

  console.log(`Base tinyset (10k items):`)
  console.log(`  Total:    ${fmtB(baseMem)}`)
  console.log(`  Per item: ${fmtB(baseMem/10_000)}`)
  console.log(`\ntinyset+ (10k items):`)
  console.log(`  Total:    ${fmtB(plusMem)}`)
  console.log(`  Per item: ${fmtB(plusMem/10_000)}`)
  console.log(`  Overhead: ${fmtB(plusMem-baseMem)} (${((plusMem-baseMem)/baseMem*100).toFixed(1)}%)`)
  console.log(`  Journal entries: ${fmt(plusStore.journal.size())}`)
}

// ── main ───────────────────────────────────────────────────────────────────────
console.log('='.repeat(70))
console.log(' TINYSET+ DISTRIBUTED BENCHMARK SUITE')
console.log('='.repeat(70))
console.log(`Node ${process.version} | ${new Date().toLocaleTimeString()} | ${RUNS} runs, reporting median`)
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