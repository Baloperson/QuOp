[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0)
# tinyset.js

A lightweight, isomorphic state container with built-in queries, transactions, and optional real-time synchronization.

TinySet provides a unified data layer that works identically in browsers, Node.js, and React Native. The core library handles local state with advanced querying; the optional `+` extension adds distributed features with causal consistency.

> The code written with TinySet reads like the question you're asking, not like the data structure that's querying it.

```
Core:    ~8kB  | 185 lines
Plus:    +4kB  | +24 lines
Total:   ~12kB
```

**The in-memory store for entity-component and spatial systems.**
Type-indexed entities, grid-based spatial queries, compound filtering, and events — in a single file, with zero dependencies.

```js
import { createStore, where } from './tinyset.js'

const store = createStore({ spatialGridSize: 100 })

const player = store.create('player', { x: 100, y: 200, hp: 100 })
store.create('enemy', { x: 115, y: 210, hp: 50, tier: 'elite' })
store.create('enemy', { x: 400, y: 300, hp: 50, tier: 'normal' })

// spatial query — grid-indexed, not a linear scan
const nearby = store.near('enemy', player.x, player.y, 80).all()

// compound filter
const threats = store.find('enemy', where.and(
  where.eq('tier', 'elite'),
  where.gt('hp', 0)
)).sort('hp').all()

store.on('delete', e => console.log(`${e.item.type} destroyed`))
store.update(nearby[0].id, { hp: 0 })
store.delete(nearby[0].id)
```

In a vanilla implementation, the equivalent store infrastructure — type indexes, spatial grid, event emitter, compound filtering — is **40–80 lines before you write any game logic**. With TinySet it's two lines of setup. For files where entity management is the main job, that's typically a **40–75% reduction in meaningful lines**.

---

## Why tinyset

Most JS data libraries are either key-value caches (fast reads, no query model) or full query engines (powerful, heavy). Neither fits the entity-component pattern well.

TinySet is built specifically for systems where you need to:

- Store thousands of typed entities and retrieve them by type instantly
- Find entities within a spatial radius — without scanning the whole set
- Filter with compound predicates and chain results
- React to changes through a lightweight event system
- Run transactions that roll back cleanly on failure

TinySet handles typed entities, spatial queries, compound filters, and change events — the infrastructure you'd otherwise rebuild for every game, simulation, or collaborative app that needs to answer "what things are near here, and which ones match these conditions?"

It's not a database or a framework. It's a small predictable layer: store entities with types, query by proximity and properties, react to changes, keep operations atomic.

It wins on **mixed workloads** — the benchmark that reflects real game loops and collaborative apps, where creates, reads, updates, and deletes happen in every frame.

---

## Benchmarks

All benchmarks run on Node v24, Intel Xeon Platinum 8370C, median of 15 runs. Compared against LokiJS, NodeCache, MemoryCache, Lodash collections, Immutable.js, and raw Array/Object stores.

> **Hardware variance.** Absolute numbers scale with your CPU — expect 2–3× lower figures on older or low-power hardware (Tested on AMD FX-6350 scores roughly half these numbers). What stays stable across machines is the *relative ordering*


### Mixed workload — 10,000 operations (40% read, 20% update, 20% simple find, 20% compound find)

| Library | ops/sec |
|---|---|
| **TinySet** | **113,844** |
| LokiJS | 86,131 |
| MemoryCache | 26,508 |
| Lodash | ~14,000 |
| NodeCache | ~13,000 |
| Immutable | ~10,000 |
| Array Store | ~9,500 |
| Object Store | ~4,300 |

TinySet leads this category. The closest competitor is LokiJS at 86,131 ops/sec — a ~32% margin. LokiJS has a native B-tree field index that gives it an advantage on compound queries specifically; TinySet closes that gap with a hot/cold query cache that promotes frequently-used compound predicates to sub-0.01ms lookup. Every other library trails by 4× or more.

The mixed workload is the benchmark that matters. Isolated read or write microbenchmarks favour specialised structures — real systems don't run isolated operations.

### Create performance — 10,000 items

| Library | ops/sec |
|---|---|
| **TinySet** | **1,032K** |
| LokiJS | 646K |
| Lodash | ~500K |
| Array Store | ~420K |
| Object Store | ~320K |

TinySet now leads creates, beating LokiJS by ~27%. The counter-based id generator (replacing `Date.now() + Math.random()`) and a single `Date.now()` call per write account for most of the improvement.

### Read performance — 100,000 random reads

| Library | ops/sec |
|---|---|
| **TinySet (ref)** | **112.7M** |
| Object Store | 15M |
| MemoryCache | 12.7M |
| Array Store | 10.9M |
| TinySet (safe get) | 8.9M |

`store.getRef()` returns the live object directly — 112.7M ops/sec. `store.get()` returns a shallow copy for external safety — 12.1M ops/sec. Use `getRef()` in hot paths where you won't mutate the result.

### Query performance — avg latency per query, 10,000 entities

| Library | Simple | Compound |
|---|---|---|
| **TinySet** | **<0.01ms** | **<0.01ms** |
| LokiJS | 0.09ms | 0.72ms |
| MemoryCache | 1.1ms | N/A |
| Array Store | 3.6ms | N/A |
| Object Store | 7.8ms | N/A |

TinySet's hot/cold query cache promotes repeated queries — including compound `where.and`/`where.or` predicates — to frozen Q objects returned in under 0.01ms. LokiJS is the only other library that supports compound operators natively, at 0.72ms for the complex path.

### Other categories

| Category | TinySet | Fastest overall |
|---|---|---|
| Update (50k) | 1,456K ops/sec | Lodash 6.5M |
| Memory per item | ~667 bytes | LokiJS 565 bytes |

### Spatial queries

TinySet's spatial index is built for **entity queries**, not raw geometry throughput. `store.near('enemy', x, y, radius)` searches only the enemy type index — in a mixed-type store this eliminates 50–90% of candidates before any distance calculation.

For pure geometry performance, dedicated spatial libraries are faster: RBush at ~0.013ms vs TinySet at ~0.22ms per query. If your workload is purely geometric without type filtering, RBush or Flatbush is the right choice. If you need `"find all enemies within range that match these conditions"` in one call, TinySet handles it natively.

---

## Installation

```bash
curl -O https://raw.githubusercontent.com/Baloperson/TinySet/main/tinyset.js
```

Or just download `tinyset.js`. No build step. No package manager required. It's one file.

---

## API

### Creating a store

```js
const store = createStore({
  spatialGridSize: 100,                          // grid cell size for spatial index (default 100)
  types: new Set(['player', 'enemy', 'bullet']), // optional type validation
  defaults: {
    enemy: { hp: 30, alive: true }               // default props per type
  },
  idGenerator: () => myCustomId()                // optional custom ID function
})
```

### Creating entities

```js
// create — returns the new entity
const enemy = store.create('enemy', { x: 100, y: 200, hp: 50 })

// createMany — create multiple entities of the same type
const enemies = store.createMany('enemy', [
  { x: 100, y: 200, hp: 50 },
  { x: 300, y: 400, hp: 30 }
])
```

### Mutating entities

```js
// update — merges changes, updates modified timestamp
store.update(enemy.id, { hp: 30 })

// functional updater — receives current state, returns changes
store.update(enemy.id, old => ({ hp: old.hp - 10 }))

// set — single field shorthand
store.set(enemy.id, 'hp', 30)

// increment — atomic field increment
store.increment(enemy.id, 'score', 10)

// delete — returns the deleted entity
store.delete(enemy.id)
store.deleteMany([id1, id2, id3])
```

### Reading entities

```js
// safe get — returns a shallow copy
const entity = store.get(id)

// ref — returns the live object (faster, don't mutate)
const entity = store.getRef(id)

// pick — returns only specified fields
const pos = store.pick(id, ['x', 'y'])

// exists
if (store.exists(id)) { ... }
```

### Querying

```js
// find by type with optional predicate
const enemies = store.find('enemy').all()
const alive = store.find('enemy', e => e.hp > 0).all()

// spatial — find entities within radius, sorted by distance
const nearby = store.near('enemy', x, y, radius).all()
const nearAlive = store.near('enemy', x, y, 100, e => e.hp > 0).first()

// count shorthand
const total = store.count('enemy')
const aliveCount = store.count('enemy', e => e.hp > 0)

// query chain
store.find('enemy', where.gt('hp', 0))
  .sort('hp')
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
where.eq('tier', 'elite')
where.ne('status', 'dead')
where.gt('hp', 50)
where.gte('level', 10)
where.lt('ttl', 0)
where.lte('price', 100)
where.in('tier', ['elite', 'boss'])
where.contains('name', 'Sword')
where.startsWith('id', 'player-')
where.exists('target')

// compose — all tagged predicates produce stable cache keys
where.and(where.eq('tier', 'elite'), where.gt('hp', 0))
where.or(where.eq('tier', 'boss'), where.gte('score', 500))
where.and(where.or(where.eq('zone', 'a'), where.eq('zone', 'b')), where.gt('hp', 0))
```

### Events

```js
// subscribe — returns unsubscribe function
const off = store.on('create', ({ id, item }) => { ... })
store.on('update', ({ id, item, old }) => { ... })
store.on('delete', ({ id, item }) => { ... })
store.on('change', ({ type, id, item }) => { ... })  // all changes

store.once('create', callback)  // fires once then removes itself

off()  // unsubscribe
```

### Transactions

```js
// all-or-nothing — rolls back on throw
store.transaction(() => {
  store.update(playerId, { hp: 0 })
  store.delete(playerId)
  store.create('ghost', { x: 100, y: 200 })
})
```

### Stats and introspection

```js
store.stats()
// {
//   items: 1204,
//   types: { player: 1, enemy: 847, bullet: 356 },
//   spatial: { cells: 42, coords: 1204 },
//   listeners: { change: 3 }
// }

store.dump()   // plain object of all items (shallow copies)
store.clear()  // removes everything, returns count
```

---

## tinyset+

`tinyset+` wraps the base store with distribution primitives: vector clocks, an operation journal, WebSocket sync, and merge strategies. Same API, same spatial index, same query engine — with an opt-in layer for real-time and collaborative applications.

```js
import { createStore } from './tinyset.plus.js'

const store = createStore({ processId: 'client-1', syncUrl: 'wss://your-server' })

// everything from tinyset works identically
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

Memory overhead for distribution: **+81%** per item (~473 bytes → ~856 bytes) due to the operation journal. The journal is capped at 10,000 entries by default and is only allocated when you use `tinyset+`.

---

## Design philosophy

**One file.** Copy it in, import it, use it. No transitive dependencies to audit, no build pipeline to configure, no version conflicts.

**Optimised for mixed workloads.** Microbenchmark winners (Lodash, MemoryCache) are specialised — they do one thing fast. Real systems do everything at once. TinySet is designed for that.

**Spatial and type indexing are first-class.** Not an afterthought or plugin. The grid cell index and type index are maintained on every write and queried together. `store.near('enemy', x, y, r)` is one call — type filtering and proximity search happen in a single pass.

**Hot/cold query cache.** Repeated `find()` calls with the same predicate — including compound `where.and`/`where.or` chains — are promoted to a hot tier after three hits and return in under 0.01ms. Writes invalidate only the cache entries for the affected type, so querying players is unaffected by enemy updates. The cache is transparent: no configuration, no manual invalidation.

**Two tiers with one API.** `tinyset.js` is the foundation — no distribution overhead, pure local performance. `tinyset+` is the ecosystem — distribution, sync, journaling — built on top of the same store. Switching between them requires changing one import line.

---

## Limitations

- **In-memory only.** No persistence built in. For persistence, serialize `store.dump()` to localStorage, IndexedDB, or your backend. `tinyset+` makes this easier with `store.checkpoint()`.
- **Single-process.** The base store has no built-in sync. Use `tinyset+` for multi-client or multi-process scenarios.
- **No schema enforcement by default.** Pass `types` to the store config for runtime type validation. Field types are not validated — tinyset is not a typed database.
- **Read performance trades off for write safety.** `store.get()` returns a shallow copy to prevent external mutation. Use `store.getRef()` for the live reference when performance matters and you won't mutate it.
- **Query cache cost on write-heavy workloads.** The hot cache adds a small overhead per write to maintain per-type version counters. Workloads that are predominantly writes with few repeated queries see a modest regression versus a bare Map store. The cache can be worked around by always using inline predicates (`e => e.hp > 0` rather than `where.gt('hp', 0)`) which bypass the hot tier.
