[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

# tinyop.js

Works anywhere with JavaScript and memory.

Tinyop is a typed entity store with spatial indexing, reactive events, and compound queries. ~10kB, zero dependencies.

> The code written with tinyop reads like the question you're asking, not like the data structure answering it.

```
Core:   ~10kB  | ~190 lines
Plus:   +4.6kB | +~24 lines
Total:  ~14kB
```

---

## What it is

Tinyop stores **typed entities** — plain objects with an `id`, a `type`, and any fields you choose. It maintains indexes automatically so you can retrieve them instantly by type, filter them with compound predicates, find them by spatial proximity, and react to changes through events — all in a single in-memory structure with zero configuration.


```js
import { createStore, where } from './tinyop.js'

const store = createStore()

// Entities are plain objects — any shape, any fields
const a = store.create('sensor', { location: 'floor-3', value: 42, active: true })
const b = store.create('sensor', { location: 'floor-1', value: 18, active: false })
const c = store.create('threshold', { min: 20, max: 80, channel: 'floor-3' })

// Retrieve by type — O(1), no scan
const sensors = store.find('sensor').all()

// Compound filter — multiple conditions, cached after first call
const active = store.find('sensor', where.and(
  where.eq('active', true),
  where.gt('value', 20)
)).all()

// React to changes
store.on('update', ({ id, item, old }) => {
  console.log(`${id}: ${old.value} → ${item.value}`)
})

// Mutations merge changes and maintain all indexes
store.update(a.id, { value: 55 })
store.set(b.id, 'active', true)
store.increment(a.id, 'value', 3)
```

---

## What it does

**Type indexing.** Every entity belongs to a type. The type index is maintained on every write. `store.find('sensor')` returns all sensors without scanning the full item set — the index hands back the Set directly.

**Compound queries with a cache.** `where.eq`, `where.gt`, `where.and`, `where.or` and the rest build predicates with stable string keys. The first call scans; every subsequent call with the same predicate returns a frozen result object in under 0.01ms. Writes evict only the cache entries whose predicate fields overlap with the changed fields — a write to `value` leaves `location` and `active` queries warm.

**Spatial indexing.** Entities with `x` and `y` coordinates are tracked in a grid cell index. `store.near(type, x, y, radius)` searches only the cells that intersect the radius, filtered to the given type, sorted by distance. Non-spatial writes skip the spatial index entirely.

**Live views.** `store.view(type, predicate)` wraps a query in a cached result that recomputes automatically when relevant entities change. Between writes the result is returned directly — no scan, no predicate evaluation. Views support spatial recentering with a movement threshold.

**Events.** `on('create' | 'update' | 'delete' | 'change' | 'batch', callback)` — subscribe to any write. Events include the item and its previous state. Unsubscribe by calling the returned function.

**Transactions.** `store.transaction(() => { ... })` — all-or-nothing. Any throw rolls back every write in the block.

**Functional updaters.** `store.update(id, old => ({ value: old.value * 2 }))` — derive the next state from current state atomically.

---

## How it works

The write path in `w()` makes decisions based on what is actually needed:

- The changed-field Set is only constructed if the query cache for that type has entries — if nothing is cached, field extraction is skipped entirely
- The pre-mutation snapshot (`old` in update events) is only spread if an update or change listener is registered
- The spatial index update is only run if `x` or `y` is among the changed fields
- Transaction logging only runs when inside a transaction

The result is a write path that pays for what it uses. A store with no listeners, no cached queries, and no spatial coordinates is close to the cost of a bare Map mutation.

---

## Benchmarks

All benchmarks: Node v22, Intel Xeon Platinum 8370C, median of 100 runs + 20 warmup(Warmed JIT) and 1 run 0 warmup(Cold Start) with a deterministic PRNG (mulberry32, fixed seed), reporting median. Compared against LokiJS, NodeCache, MemoryCache, QuickLRU, Lodash collections, Immutable.js, and raw Array/Object stores.

> **Hardware variance.** Absolute numbers scale with your CPU — the relative ordering is what stays stable. Run `node bench.js` to measure on your own hardware.

### Mixed workload — 10,000 operations (40% read · 20% update · 20% find · 20% compound find)


| Library | Cold Start (ops/sec) | Warmed JIT (ops/sec) |
|---------|---------------------|---------------------|
| **tinyop (ref)** | **1,457,095** | **8,549,449** |
| **tinyop (safe get)** | **1,430,647** | **7,139,960** |
| LokiJS | 67,574 | 85,987 |
| MemoryCache | 22,450 | 27,806 |
| Lodash | 19,376 | 27,841 |
| NodeCache | 21,728 | 26,959 |
| QuickLRU | 18,489 | 27,676 |
| Immutable | 20,184 | 21,021 |
| Array Store | 15,892 | 17,446 |
| Object Store | 9,888 | 10,976 |


The mixed workload is the one that reflects real usage.
**TinyOp is 50-500× faster than every other library in real-world mixed workloads** 
the gap widens dramatically after JIT warmup, which reflects long-running application behavior.

The headline improvement over earlier versions is primarily from v3.5 field-aware cache invalidation. Before v3.5, every write evicted all cached queries for that type — every find in the 40% of mixed-workload operations paid the full scan cost. With field-aware invalidation, a write to `hp` leaves `zone` and `active` queries warm. In a workload with frequent writes and repeated queries, the cache hit rate on the query portion increases substantially and that directly multiplies throughput. 

### Create — 10,000 items

| Library | Cold Start (ops/sec) | Warmed JIT (ops/sec) |
|---------|---------------------|---------------------|
| Array Store | 1,097,354 | 3,919,590 |
| Lodash | 1,135,045 | 3,876,588 |
| QuickLRU | 1,086,046 | 2,877,124 |
| LokiJS | 728,695 | 2,674,146 |
| **tinyop (ref)** | **831,066** | **2,403,271** |
| **tinyop (safe get)** | **601,651** | **2,204,061** |
| Object Store | 895,596 | 2,413,435 |
| MemoryCache | 489,873 | 1,761,316 |
| Immutable | 209,405 | 1,755,175 |
| NodeCache | 215,086 | 599,582 |


### Read — 100,000 random reads

| Library | Cold Start (ops/sec) | Warmed JIT (ops/sec) |
|---------|---------------------|---------------------|
| **tinyop (ref)** | **22,121,598** | **112,066,038** |
| Array Store | 13,042,127 | 29,358,608 |
| Lodash | 21,786,820 | 28,297,797 |
| QuickLRU | 14,991,823 | 21,800,195 |
| Object Store | 10,209,436 | 20,395,464 |
| MemoryCache | 12,951,977 | 19,187,023 |
| **tinyop (safe get)** | **3,705,392** | **14,968,267** |
| Immutable | 4,178,187 | 14,520,987 |
| LokiJS | 4,266,869 | 8,028,588 |
| NodeCache | 919,979 | 1,326,635 |


`store.getRef()` returns the live object directly — 109.3M ops/sec. `store.get()` returns a shallow copy — 12.6M ops/sec. Use `getRef()` in hot paths where you will not mutate the result.

### Update — 50,000 updates


| Library | Cold Start (ops/sec) | Warmed JIT (ops/sec) |
|---------|---------------------|---------------------|
| Array Store | 2,669,083 | 7,674,113 |
| Lodash | 5,522,604 | 7,545,621 |
| QuickLRU | 2,475,714 | 6,102,144 |
| Object Store | 1,795,726 | 5,650,910 |
| **tinyop (ref)** | **2,469,237** | **5,023,976** |
| **tinyop (safe get)** | **2,263,410** | **5,111,053** |
| MemoryCache | 1,860,320 | 3,171,068 |
| LokiJS | 988,538 | 2,275,467 |
| Immutable | 643,840 | 1,449,429 |
| NodeCache | 357,440 | 662,883 |

Isolated update microbenchmarks favour raw stores that do nothing beyond setting a property. Each tinyop write maintains type and spatial indexes, derives changed fields for selective cache invalidation, and handles transaction logging. The mixed workload, where these investments pay back through cache-hit reads and queries, is the relevant comparison.

### Query — avg latency per query, 10,000 entities

| Library | Simple | Compound | Repeat |
|---|---|---|---|
| **tinyop** | **<0.01ms** | **<0.01ms** | **~0.00ms** |
| LokiJS | 0.04ms | 0.41ms | 0.41ms |
| MemoryCache | 0.64ms | N/A | 0.64ms |
| Array Store | 2.18ms | N/A | 2.18ms |
| Object Store | 5.26ms | N/A | 5.26ms |

LokiJS is the only other library with native compound operator support. Every repeat query pays 0.41ms regardless of what changed. Tinyop's field-aware invalidation keeps unrelated predicates warm, so repeated access between writes is effectively free.

### Spatial — avg per query, 10,000 points

| | Unfiltered | Filtered |
|---|---|---|
| RBush | 0.008ms | — |
| Flatbush | 0.008ms | — |
| **tinyop** | **0.080ms** | **0.051ms** |

The filtered path is faster than unfiltered because the predicate prunes candidates before distance computation. For pure geometry without type filtering, RBush or Flatbush is faster. For `"all entities within range that match these conditions"` in one call, tinyop handles it natively.

### Memory — per 10,000 items

| Library | Per item |
|---|---|
| Object Store | 572B |
| **tinyop** | **~601B** |
| Array Store | 637B |
| LokiJS | 699B |
| NodeCache | 1.04KB |

---

## Installation

```bash
npm install tinyop
```

```js
import { createStore, where } from 'tinyop'
```

Or drop a single file into your project — no build step, no package manager:

```bash
curl -O https://raw.githubusercontent.com/Baloperson/TinyOp/main/tinyop.js
```

---

## API

### Store configuration

```js
const store = createStore({
  spatialGridSize: 100,          // grid cell size for spatial index (default: 100)
  types: new Set(['a', 'b']),    // optional: restrict to known types
  defaults: { a: { count: 0 } },// optional: default fields per type
  idGenerator: () => myId()      // optional: custom ID function
})
```

### Creating entities

```js
// create — returns the new entity
const item = store.create('foo', { x: 0, y: 0, value: 1 })

// createMany — same type, array of props
const items = store.createMany('foo', [{ value: 1 }, { value: 2 }])
```

### Mutating entities

```js
// update — merges changes, returns updated entity
store.update(id, { value: 2 })

// functional updater — current state in, changes out
store.update(id, old => ({ value: old.value + 1 }))

// set — single field
store.set(id, 'value', 2)

// increment — numeric field shorthand
store.increment(id, 'value', 1)    // default delta: 1
store.increment(id, 'value', -5)

// delete — returns the removed entity
const removed = store.delete(id)
store.deleteMany([id1, id2, id3])
```

### Batch operations

```js
// batch.update — silent per-item writes, one 'batch' event at the end
store.batch.update([
  { id: id1, changes: { value: 10 } },
  { id: id2, changes: { value: 20 } },
])

store.batch.delete([id1, id2])
store.batch.create('foo', [{ value: 1 }, { value: 2 }])
```

### Reading entities

```js
store.get(id)            // shallow copy — safe to keep a reference to
store.getRef(id)         // live object — faster, do not mutate
store.pick(id, ['x','y'])// specific fields only; nested objects are deep-cloned
store.exists(id)         // boolean
```

### Querying

```js
// All entities of a type
store.find('foo').all()

// Filtered
store.find('foo', where.gt('value', 10)).all()

// Spatial — sorted by distance from point
store.near('foo', x, y, radius).all()
store.near('foo', x, y, radius, predicate).first()

// Count shorthand
store.count('foo')
store.count('foo', where.eq('active', true))

// Query chain — all methods return a new chainable Q
store.find('foo', where.gt('value', 0))
  .sort('value')        // ascending by field
  .limit(10)
  .offset(20)
  .all()                // → Entity[]
  .first()              // → Entity | null
  .last()               // → Entity | null
  .count()              // → number
  .ids()                // → string[]
```

### `where` predicates

All tagged predicates produce stable cache keys and benefit from field-aware invalidation. They compose without limit.

```js
where.eq('status', 'ok')
where.ne('status', 'error')
where.gt('score', 100)
where.gte('score', 100)
where.lt('ttl', 0)
where.lte('price', 50)
where.in('tag', ['a', 'b', 'c'])
where.exists('ref')

// String matching — inline predicates, always scan (no cache key)
where.contains('name', 'sub')
where.startsWith('name', 'pre')
where.endsWith('name', 'suf')

// Composition — stable cache keys, field-aware invalidation applies to all fields
where.and(where.eq('active', true), where.gt('score', 0))
where.or(where.eq('tag', 'a'), where.eq('tag', 'b'))
where.and(
  where.or(where.eq('zone', 1), where.eq('zone', 2)),
  where.gt('score', 0)
)
```

### Views

A view is a live cached result. Between writes it returns the cached array directly — no scan. It recomputes lazily after any write that touches its type.

```js
// Basic view
const highValue = store.view('foo', where.gt('value', 100))
highValue()   // → Entity[]

// Spatial view — stays sorted by distance from origin
const nearby = store.view('foo', where.eq('active', true), {
  spatial: true,
  x: origin.x,
  y: origin.y,
  r: 500,
})
nearby()   // → Entity[], sorted by distance

// Recenter without forcing recompute
// threshold: skip recompute if movement is within N units (default: 0)
nearby.recenter(newX, newY)

const nearbyThresh = store.view('foo', null, {
  spatial: true, x: 0, y: 0, r: 500, threshold: 25
})

// Remove the invalidation listener when the view is no longer needed
highValue.destroy()
```

### Events

```js
const off = store.on('create', ({ id, item }) => { })
store.on('update', ({ id, item, old }) => { })   // old is present only when a listener was registered before the write
store.on('delete', ({ id, item }) => { })
store.on('change', ({ type, id, item }) => { })  // all writes
store.on('batch',  ({ op, count }) => { })       // batch operations

store.once('create', callback)  // fires once, then removes itself

off()  // unsubscribe
store.off('update', callback)
```

### Transactions

```js
// All writes in the block succeed together or roll back together on throw
store.transaction(() => {
  store.update(id1, { value: 0 })
  store.create('foo', { value: 1 })
  store.delete(id2)
  // throw here → all three operations are reversed
})
```

### Introspection

```js
store.stats()
// {
//   items: 1042,
//   types: { foo: 800, bar: 242 },
//   spatial: { cells: 36, coords: 1042 },
//   listeners: { change: 2 }
// }

store.dump()   // plain object snapshot — shallow copies of all entities
store.clear()  // removes everything, returns previous count

store.meta.get('key')
store.meta.set('key', value)
store.meta.config()   // returns a copy of the store configuration
```

---

## Tests

```bash
node --test test.js
```

78 tests covering the full API, query cache correctness, field-aware invalidation, and spatial index.

---

## tinyop+

`tinyop+` wraps the base store with distribution primitives: vector clocks, an operation journal, WebSocket sync, and merge strategies. The API is identical — switching requires changing one import line.

```js
import { createStore } from './tinyop.plus.js'

const store = createStore({
  processId: 'node-1',
  syncUrl: 'wss://your-server',
})

// All tinyop operations work identically
store.create('msg', { text: 'hello', from: 'alice' })

// Distribution layer
const snapshot = store.sync.export(lastSyncTimestamp)
const { applied } = store.sync.import(remoteSnapshot)

store.clock.current()    // → local counter
store.clock.get()        // → { 'node-1': 42, 'node-2': 38 }

store.journal.list()
store.journal.query({ type: 'create', since: timestamp })
store.journal.on(op => sendToServer(op))

store.merge(otherStore, 'timestamp')   // last-write-wins by modified timestamp
```

### Distribution benchmark — Node v24, Xeon Platinum 8370C

| Operation | Speed |
|---|---|
| Journal writes | 267K ops/sec |
| Clock snapshots | 6.8M ops/sec |
| Clock merges | 20.5M ops/sec |
| Export (1K ops) | 745K ops/sec |
| Affine batch apply (10K items) | 415M items/sec |

Memory overhead: **+81%** per item (~473B → ~856B) from the operation journal, capped at 10,000 entries by default and only allocated when using `tinyop+`.

---

## Design philosophy

**One file.** Copy it in, import it, use it.

**Optimised for mixed workloads.** The write path invests in indexes and cache maintenance. The read path collects the return on that investment. Workloads that only write and never query see overhead; workloads that mix reads, writes, and queries see the largest gains.

**Two tiers, one API.** `tinyop.js` is the foundation — pure local performance with no distribution overhead. `tinyop+` is the distribution layer built on top. Switching is one import line. Downgrading is the same.

---

## Limitations

- **In-memory only.** Serialize `store.dump()` to localStorage, IndexedDB, or a backend for persistence. `tinyop+` simplifies this with `store.checkpoint()`.
- **Single-process.** The base store has no sync. Use `tinyop+` for multi-client or multi-process scenarios.
- **No schema enforcement by default.** Pass `types` to `createStore` for runtime type validation. Field types are not validated.
- **`store.get()` returns a shallow copy.** Prevents external mutation of stored state. Use `store.getRef()` when the copy overhead matters and you will not mutate the result.
- **Field-aware invalidation applies only to tagged predicates.** Inline predicates (`e => e.value > 0`) carry no field information and are evicted on any write to their type. Use `where.gt('value', 0)` to benefit from selective invalidation.
- **`old` in update events reflects pre-write state only when a listener is registered.** The snapshot is not computed unless something will consume it.
- **Writes that include `x` or `y` always run the full spatial update.** Writes to other fields skip the spatial block.
- **Views recompute lazily after any write to their type.** The cached result stays valid between writes; it recomputes on the next read after a write.
- **Transactions do not isolate reads.** Reads inside a transaction see the partially-committed state.
- **NaN and Infinity are valid coordinates.** Validate spatial inputs before storing.
- **`__proto__` is a valid field name.** Property names are not sanitized.

---

## Version history

| Version | Change |
|---|---|
| v3.5 | Field-aware cache invalidation — writes evict only predicates whose fields intersect the changed fields |
| v3.5.1 | Spatial skip on non-spatial writes; `Array` candidate collection in `near()`; batch `qbump`; `qi` size guard |
| v3.6 | Adaptive computation — defer Set construction, snapshot spreads, and index updates to when they are actually needed |
