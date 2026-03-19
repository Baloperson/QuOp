[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)

# tinyop.js

Works anywhere with JavaScript and memory.

Tinyop is a typed entity store with spatial indexing, reactive events, and compound queries. 10kB, zero dependencies. The infrastructure you'd otherwise rebuild.

tinyop provides a unified data layer that works identically in browsers, Node.js, and React Native. The core library handles local state with advanced querying; the optional `+` extension adds distributed features with causal consistency.

> The code written with tinyop reads like the question you're asking, not like the data structure that's querying it.

```
Core:    10kB  | ~185 lines
Plus:    +4.6kB  | +~24 lines
Total:   ~15kB
```

**The in-memory store for entity-component and spatial systems.**
Type-indexed entities, grid-based spatial queries, compound filtering, and events — in a single file, with zero dependencies.

```js
import { createStore, where } from './tinyop.js'

const store = createStore({ spatialGridSize: 100 })

// Create typed entities with any schema
const a = store.create('typeA', { x: 100, y: 200, value: 100, tag: 'foo' })
store.create('typeA', { x: 115, y: 210, value: 50, tag: 'bar' })
store.create('typeB', { x: 400, y: 300, value: 50, tag: 'baz' })

// Spatial query — grid-indexed, finds entities near a point
const nearby = store.near('typeA', a.x, a.y, 80).all()

// Compound filter — multiple conditions combined
const filtered = store.find('typeA', where.and(
  where.eq('tag', 'bar'),
  where.gt('value', 0)
)).sort('value').all()

// React to changes
store.on('delete', e => console.log(`${e.item.type} removed`))

// Atomic updates
store.update(nearby[0].id, { value: 0 })
store.delete(nearby[0].id)
```

In a vanilla implementation, the equivalent store infrastructure — type indexes, spatial grid, event emitter, compound filtering — is **40–80 lines before you write any application logic**. With tinyop it's two lines of setup. For files where entity management is the main job, that's typically a **40–75% reduction in meaningful lines**.

---

## Why tinyop

Most JS data libraries are either key-value caches (fast reads, no query model) or full query engines (powerful, heavy). Neither fits the entity-component pattern well.

tinyop is built specifically for systems where you need to:

- Store thousands of typed entities and retrieve them by type instantly
- Find entities within a spatial radius — without scanning the whole set
- Filter with compound predicates and chain results
- React to changes through a lightweight event system
- Run transactions that roll back cleanly on failure

tinyop handles typed entities, spatial queries, compound filters, and change events — the infrastructure you'd otherwise rebuild for every game, simulation, or collaborative app that needs to answer "what things are near here, and which ones match these conditions?"

It's not a database or a framework. It's a small predictable layer: store entities with types, query by proximity and properties, react to changes, keep operations atomic.

It wins on **mixed workloads** — the benchmark that reflects real application loops where creates, reads, updates, and deletes happen together.

---

## Benchmarks

All benchmarks run on Node v22, Intel Xeon Platinum 8370C, median of 15 runs. Compared against LokiJS, NodeCache, MemoryCache, Lodash collections, Immutable.js, and raw Array/Object stores.

> **Hardware variance.** Absolute numbers scale with your CPU — an AMD FX-6350 scores roughly half these figures. What stays stable across machines is the *relative ordering*. Run `node bench.js` to measure on your own hardware.

### Mixed workload — 10,000 operations (40% read, 20% update, 20% simple find, 20% compound find)

| Library | ops/sec |
|---|---|
| **tinyop** | **115,978** |
| LokiJS | 85,354 |
| QuickLRU | 26,588 |
| MemoryCache | 26,404 |
| Lodash | 26,161 |
| NodeCache | 24,704 |
| Immutable | 18,878 |
| Array Store | 16,995 |
| Object Store | 9,004 |

tinyop leads this category. The closest competitor is LokiJS at 85,354 ops/sec — a ~36% margin. LokiJS has a native B-tree field index that gives it an advantage on compound queries specifically; tinyop closes that gap with an LRU query cache (128 entry) that promotes frequently-used predicates to sub-0.01ms lookup. Every other library trails by 4× or more.

The mixed workload is the benchmark that matters. Isolated read or write microbenchmarks favour specialised structures — real systems don't run isolated operations.

### Create performance — 10,000 items

| Library | ops/sec |
|---|---|
| **tinyop** | **1,885K** |
| Lodash | 1,412K |
| LokiJS | 1,280K |
| QuickLRU | 1,193K |
| Array Store | 1,152K |
| Object Store | 693K |

tinyop leads creates, beating LokiJS by ~47%. The counter-based id generator (replacing `Date.now() + Math.random()`) and a single `Date.now()` call per write account for most of the improvement.

### Read performance — 100,000 random reads

| Library | ops/sec |
|---|---|
| **tinyop (ref)** | **111.7M** |
| MemoryCache | 26.2M |
| Object Store | 19.1M |
| Lodash | 17.5M |
| Array Store | 17.0M |
| tinyop (safe get) | 13.8M |
| QuickLRU | 11.8M |
| LokiJS | 7.2M |
| Immutable | 3.5M |
| NodeCache | 1.6M |

`store.getRef()` returns the live object directly — 111.7M ops/sec. `store.get()` returns a shallow copy for external safety — 13.8M ops/sec. Use `getRef()` in hot paths where you won't mutate the result.

### Query performance — avg latency per query, 10,000 entities

| Library | Simple | Compound | View (repeat query) |
|---|---|---|---|
| **tinyop** | **<0.01ms** | **<0.01ms** | **~0.00ms** |
| LokiJS | 0.06ms | 0.37ms | 0.37ms |
| MemoryCache | 1.1ms | N/A | 1.1ms |
| Array Store | 1.89ms | N/A | 1.89ms |
| Object Store | 7.8ms | N/A | 7.8ms |

tinyop's LRU query cache promotes repeated queries — including compound `where.and`/`where.or` predicates — to frozen Q objects returned in under 0.01ms. **v3.4 adds views** (`store.view(type, predicate)`), which maintain a live cached result set that updates automatically when relevant entities change. Between writes, repeated access to a view returns the cached array in O(1) — latency drops below measurable threshold after the first evaluation. Views also support spatial recentering without recomputation when movement stays within a configured threshold.

LokiJS is the only other library that supports compound operators natively, at 0.37ms for the complex path — and every repeat query pays that cost again.

### Other categories

| Category | tinyop | Fastest overall |
|---|---|---|
| Update (50k) | 3,522K ops/sec | Array Store 6,747K |
| Memory per item | ~667 bytes | LokiJS 565 bytes |

### Spatial queries

tinyop's spatial index is built for **entity queries**, not raw geometry throughput. `store.near('typeA', x, y, radius)` searches only the typeA index — in a mixed-type store this eliminates 50–90% of candidates before any distance calculation. With v3.4, spatial queries can be wrapped in views that recenter efficiently without rebuilding the result set when movement stays within a configured threshold.

For pure geometry performance, dedicated spatial libraries are faster: RBush at ~0.010ms vs tinyop at ~0.110ms per query. If your workload is purely geometric without type filtering, RBush or Flatbush is the right choice. If you need `"find all entities within range that match these conditions"` in one call, tinyop handles it natively — type filtering and proximity search happen in a single pass, with O(1) view access on repeated queries.

---

## Installation

```bash
npm install tinyop
```

```js
import { createStore, where } from 'tinyop'
```

Or copy a single file into your project — no build step, no package manager required:

```bash
curl -O https://raw.githubusercontent.com/Baloperson/TinyOp/main/tinyop.js
```

---

## API

### Creating a store

```js
const store = createStore({
  spatialGridSize: 100,                          // grid cell size for spatial index (default 100)
  types: new Set(['foo', 'bar', 'baz']),         // optional type validation
  defaults: {
    foo: { count: 0, active: true }              // default props per type
  },
  idGenerator: () => customId()                  // optional custom ID function
})
```

### Creating entities

```js
// create — returns the new entity
const item = store.create('foo', { x: 100, y: 200, count: 5 })

// createMany — create multiple entities of the same type
const items = store.createMany('foo', [
  { x: 100, y: 200, count: 5 },
  { x: 300, y: 400, count: 3 }
])
```

### Mutating entities

```js
// update — merges changes, updates modified timestamp
store.update(item.id, { count: 3 })

// functional updater — receives current state, returns changes
store.update(item.id, old => ({ count: old.count - 1 }))

// set — single field shorthand
store.set(item.id, 'count', 3)

// increment — atomic field increment
store.increment(item.id, 'count', 1)

// delete — returns the deleted entity
store.delete(item.id)
store.deleteMany([id1, id2, id3])
```

### Batch operations

```js
// batch.create — alias for createMany
store.batch.create('foo', [{ count: 1 }, { count: 2 }])

// batch.update — silent per-item writes, one 'batch' event
store.batch.update([
  { id: id1, changes: { count: 10 } },
  { id: id2, changes: { count: 20 } }
])

// batch.delete — alias for deleteMany
store.batch.delete([id1, id2, id3])
```

### Reading entities

```js
// safe get — returns a shallow copy
const entity = store.get(id)

// ref — returns the live object (faster, don't mutate)
const entity = store.getRef(id)

// pick — returns only specified fields (nested objects are deep-cloned)
const fields = store.pick(id, ['x', 'y'])

// exists
if (store.exists(id)) { ... }
```

### Querying

```js
// find by type with optional predicate
const all = store.find('foo').all()
const filtered = store.find('foo', e => e.count > 0).all()

// spatial — find entities within radius, sorted by distance
const nearby = store.near('foo', x, y, radius).all()
const nearFiltered = store.near('foo', x, y, 100, e => e.count > 0).first()

// count shorthand
const total = store.count('foo')
const filteredCount = store.count('foo', e => e.count > 0)

// query chain
store.find('foo', where.gt('count', 0))
  .sort('count')
  .limit(5)
  .offset(0)
  .all()    // → array
  .first()  // → first item or null
  .last()   // → last item or null
  .count()  // → number
  .ids()    // → array of ids
```

### `where` predicates

```js
where.eq('status', 'active')
where.ne('mode', 'disabled')
where.gt('value', 50)
where.gte('priority', 10)
where.lt('ttl', 0)
where.lte('price', 100)
where.in('category', ['a', 'b', 'c'])
where.contains('name', 'pattern')
where.startsWith('id', 'prefix-')
where.exists('reference')

// compose — tagged predicates produce stable cache keys and hit the hot query tier,
// including when nested
where.and(where.eq('status', 'active'), where.gt('value', 0))
where.or(where.eq('mode', 'auto'), where.gte('priority', 5))
where.and(where.or(where.eq('zone', '1'), where.eq('zone', '2')), where.gt('value', 0))
```

Note: `contains`, `startsWith`, and `endsWith` use inline predicates and do not produce cache keys — they always scan. Use `where.eq` or `where.in` for hot-path filtering where cache hits matter.

### Views

Views maintain a live cached result that is recomputed automatically when relevant entities change. Between writes, repeated access is O(1) — the cached array is returned directly.

```js
// basic view — cached until any 'foo' entity changes
const activeItems = store.view('foo', where.gt('count', 0))
activeItems()  // → array

// spatial view — entities near a point, optionally filtered
const nearbyEnemies = store.view('enemy', where.eq('hostile', true), {
  spatial: true,
  x: player.x,
  y: player.y,
  r: 200
})
nearbyEnemies()  // → sorted by distance

// recenter — update the query origin
// if movement is within threshold, the cached result is reused
nearbyEnemies.recenter(player.x, player.y)

// threshold — only recomputes when the origin moves more than N units (default 0)
const view = store.view('enemy', null, {
  spatial: true, x: 0, y: 0, r: 200, threshold: 20
})

// cleanup — removes the invalidation listener
activeItems.destroy()
```

Views are well-suited to game loops and reactive UI where the same query runs every frame. Writes invalidate only views whose type was affected — querying one type is unaffected by writes to another.

### Events

```js
// subscribe — returns unsubscribe function
const off = store.on('create', ({ id, item }) => { ... })
store.on('update', ({ id, item, old }) => { ... })
store.on('delete', ({ id, item }) => { ... })
store.on('change', ({ type, id, item }) => { ... })  // all changes
store.on('batch', ({ op, count }) => { ... })        // batch operations

store.once('create', callback)  // fires once then removes itself

off()  // unsubscribe
```

### Transactions

```js
// all-or-nothing — rolls back on throw
store.transaction(() => {
  store.update(id1, { value: 0 })
  store.delete(id2)
  store.create('foo', { x: 100, y: 200 })
})
```

### Stats and introspection

```js
store.stats()
// {
//   items: 1204,
//   types: { foo: 847, bar: 356, baz: 1 },
//   spatial: { cells: 42, coords: 1204 },
//   listeners: { change: 3 }
// }

store.dump()   // plain object snapshot of all items (shallow copies)
store.clear()  // removes everything, returns count
```

---

## Tests

```bash
node --test test.js
```

78 tests covering the core API, query cache correctness, and spatial index.

---

## tinyop+

`tinyop+` wraps the base store with distribution primitives: vector clocks, an operation journal, WebSocket sync, and merge strategies. Same API, same spatial index, same query engine — with an opt-in layer for real-time and collaborative applications.

```js
import { createStore } from './tinyop.plus.js'

const store = createStore({ processId: 'client-1', syncUrl: 'wss://your-server' })

// everything from tinyop works identically
store.create('message', { text: 'hello', userId: 'alice' })

// plus: export/import operations for sync
const snapshot = store.sync.export(lastSyncTimestamp)
const { applied } = store.sync.import(remoteSnapshot)

// vector clock
store.clock.current()  // → local counter
store.clock.get()      // → { 'client-1': 42, 'client-2': 38 }

// operation journal
store.journal.list()                          // → all recorded ops
store.journal.query({ type: 'create', since: timestamp })
store.journal.on(op => sendToServer(op))      // stream ops as they happen

// merge two stores (e.g. after offline period)
store.merge(otherStore, 'timestamp')          // last-write-wins by modified timestamp
```

### Distribution benchmark (Node v24, Intel Xeon Platinum 8370C)

| Operation | Speed |
|---|---|
| Journal writes | 267K ops/sec |
| Clock snapshots | 6.8M ops/sec |
| Clock merges | 20.5M ops/sec |
| Export (1K ops) | 745K ops/sec |
| Affine batch apply (10K items) | 415M items/sec |

Memory overhead for distribution: **+81%** per item (~473 bytes → ~856 bytes) due to the operation journal. The journal is capped at 10,000 entries by default and is only allocated when you use `tinyop+`.

---

## Design philosophy

**One file.** Copy it in, import it, use it. No transitive dependencies to audit, no build pipeline to configure, no version conflicts.

**Optimised for mixed workloads.** Microbenchmark winners (Lodash, MemoryCache) are specialised — they do one thing fast. Real systems do everything at once. tinyop is designed for that.

**Spatial and type indexing are first-class.** Not an afterthought or plugin. The grid cell index and type index are maintained on every write and queried together. `store.near('typeA', x, y, r)` is one call — type filtering and proximity search happen in a single pass.

**Hot/cold query cache.** Repeated `find()` calls with the same predicate — including compound `where.and`/`where.or` chains — are promoted to a hot tier and return in under 0.01ms. Writes invalidate only the cache entries for the affected type, so querying one type is unaffected by writes to another. The cache is transparent: no configuration, no manual invalidation.

**Views for zero-cost repeat access.** `store.view()` wraps a query in a live cached result. Between writes the cached array is returned directly — no scan, no predicate evaluation. Views support spatial recentering with a movement threshold, making them suitable for game loops where the query origin changes every frame but the result set doesn't need to.

**Two tiers with one API.** `tinyop.js` is the foundation — no distribution overhead, pure local performance. `tinyop+` is the ecosystem — distribution, sync, journaling — built on top of the same store. Switching between them requires changing one import line.

---

## Limitations

- **In-memory only.** No persistence built in. For persistence, serialize `store.dump()` to localStorage, IndexedDB, or your backend. `tinyop+` makes this easier with `store.checkpoint()`.
- **Single-process.** The base store has no built-in sync. Use `tinyop+` for multi-client or multi-process scenarios.
- **No schema enforcement by default.** Pass `types` to the store config for runtime type validation. Field types are not validated — tinyop is not a typed database.
- **Read performance trades off for write safety.** `store.get()` returns a shallow copy to prevent external mutation. Use `store.getRef()` for the live reference when performance matters and you won't mutate it.
- **Query cache overhead on write-heavy workloads.** The hot cache adds a small overhead per write to maintain per-type version counters. Workloads that are predominantly writes with few repeated queries see a modest regression versus a bare Map store. Use inline predicates (`e => e.count > 0` rather than `where.gt('count', 0)`) to bypass the hot tier when needed.
- **Small stores with non-repeated queries see no cache benefit.** The hot/cold cache pays off when the same predicate is called multiple times between writes. For one-shot queries over a handful of entities, a plain Map is faster.
- **Transactions don't isolate reads.** Reads inside a transaction see the partially-committed state — you may observe intermediate values if the transaction modifies entities before completing.
- **Cache invalidation is per-type, not per-predicate.** Any write to a type clears all cached queries for that type, including those whose results wouldn't change. In write-heavy workloads with many distinct predicates, cache churn can outweigh cache benefit.
- **Views recompute on any write to their type.** The cached result is valid until a relevant entity changes, then recomputed lazily on next access. Views are not persistent background caches.
- **NaN/Infinity are valid coordinates.** Validate spatial inputs yourself — tinyop does not reject them and they will produce incorrect spatial query results.
- **`__proto__` is a valid key.** Property names are not sanitized. Avoid using prototype-reserved names as entity field names.
