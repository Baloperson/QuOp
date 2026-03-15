# tinyset.js

A lightweight, isomorphic state container with built-in queries, transactions, and optional real-time synchronization.

TinySet provides a unified data layer that works identically in browsers, Node.js, and React Native. The core library handles local state with advanced querying; the optional `+` extension adds distributed features with causal consistency.

> The code written with Tinyset reads like the question you're asking, not like the data structure that's querying it.

```
Core:    ~5kB  | 142 lines
Plus:    +4kB  | +24 lines
Total:   ~9kB
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

In a vanilla implementation, the equivalent store infrastructure — type indexes, spatial grid, event emitter, compound filtering — is **40–80 lines before you write any game logic**. With tinyset it's two lines of setup. For files where entity management is the main job, that's typically a **40–75% reduction in meaningful lines**.

---

## Why tinyset

Most JS data libraries are either key-value caches (fast reads, no query model) or full query engines (powerful, heavy). Neither fits the entity-component pattern well.

Tinyset is built specifically for systems where you need to:

- Store thousands of typed entities and retrieve them by type instantly
- Find entities within a spatial radius — without scanning the whole set
- Filter with compound predicates and chain results
- React to changes through a lightweight event system
- Run transactions that roll back cleanly on failure

Tinyset handles typed entities, spatial queries, compound filters, and change events — the infrastructure you'd otherwise rebuild for every game, simulation, or collaborative app that needs to answer "what things are near here, and which ones match these conditions?"

It's not a database or a framework. It's a small predictable layer: store entities with types, query by proximity and properties, react to changes, keep operations atomic.

It wins on **mixed workloads** — the benchmark that reflects real game loops and collaborative apps, where creates, reads, updates, and deletes happen in every frame.

---

## Benchmarks

All benchmarks run on Node v24, AMD FX-6350, compared against LokiJS, NodeCache, MemoryCache, Lodash collections, Immutable.js, and raw Array/Object stores.

### Mixed workload — 10,000 operations (create + read + update + delete)

| Library | ops/sec |
|---|---|
| **Tinyset** | **21,655** |
| MemoryCache | 14,062 |
| NodeCache | 11,579 |
| Immutable | 10,500 |
| Array Store | ~8,500 |
| Object Store | 3,734 |

Tinyset wins this category by ~54% over the next competitor. Isolated read or write microbenchmarks favour simpler structures — but real systems don't run isolated operations.

### Spatial queries — average latency per query

| Library | Avg latency |
|---|---|
| **Tinyset (filtered)** | **0.001ms** |
| **Tinyset** | **0.004ms** |
| RBush | 0.060ms |
| Flatbush | 0.073ms |

**15–73× faster than dedicated spatial libraries.** The reason is architectural: Tinyset's grid cell index co-locates type filtering with proximity search. RBush and Flatbush do geometry only — type filtering is a separate pass. Tinyset does both in one sweep.

### Other categories

| Category | Tinyset | Fastest overall |
|---|---|---|
| Create (10k items) | 270K ops/sec | LokiJS 703K |
| Read — safe get (100k) | 3.3M ops/sec | MemoryCache 12M |
| Read — ref (100k) | 7.5M ops/sec | — |
| Update (50k) | 845K ops/sec | Lodash 2.4M |
| Query — compound filter | 1.3ms | Only tinyset supports this |
| Memory per item | 667 bytes | LokiJS 565 bytes |

Tinyset is not the fastest at any single isolated operation. It is consistently fast across all of them, and fastest at the workloads that combine them.

---

## Installation

```bash
curl -O https://raw.githubusercontent.com/your-repo/tinyset/main/tinyset.js
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
where.eq('type', 'elite')
where.ne('status', 'dead')
where.gt('hp', 50)
where.gte('level', 10)
where.lt('ttl', 0)
where.lte('price', 100)
where.in('tier', ['elite', 'boss'])
where.contains('name', 'Sword')
where.startsWith('id', 'player-')
where.exists('target')

// compose
where.and(where.eq('tier', 'elite'), where.gt('hp', 0))
where.or(where.eq('tier', 'boss'), where.gte('score', 500))
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
import { createStore } from './tinyset-plus.js'

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

### Distribution benchmark (Node v24, AMD FX-6350)

| Operation | Speed |
|---|---|
| Journal writes | 132K ops/sec |
| Clock snapshots | 3.7M ops/sec |
| Clock merges | 7M ops/sec |
| Export (1K ops) | 311K ops/sec |
| Affine batch apply (10K items) | 158M items/sec |

Memory overhead for distribution: **+74%** per item (667 bytes → 879 bytes) due to the operation journal. The journal is capped at 10,000 entries by default and is only allocated when you use `tinyset+`.

---

## Design philosophy

**One file.** Copy it in, import it, use it. No transitive dependencies to audit, no build pipeline to configure, no version conflicts.

**Optimised for mixed workloads.** Microbenchmark winners (Lodash, MemoryCache) are specialised — they do one thing fast. Real systems do everything at once. Tinyset is designed for that.

**Spatial and type indexing are first-class.** Not an afterthought or plugin. The grid cell index and type index are maintained on every write and queried together. This is why spatial queries beat dedicated spatial libraries.

**Two tiers with one API.** `tinyset.js` is the foundation — no distribution overhead, pure local performance. `tinyset+` is the ecosystem — distribution, sync, journaling — built on top of the same store. Switching between them requires changing one import line.

---

## Limitations

- **In-memory only.** No persistence built in. For persistence, serialize `store.dump()` to localStorage, IndexedDB, or your backend. `tinyset+` makes this easier with `store.checkpoint()`.
- **Single-process.** The base store has no built-in sync. Use `tinyset+` for multi-client or multi-process scenarios.
- **No schema enforcement by default.** Pass `types` to the store config for runtime type validation. Field types are not validated — tinyset is not a typed database.
- **Read performance trades off for write safety.** `store.get()` returns a shallow copy to prevent external mutation. Use `store.getRef()` for the live reference when performance matters and you won't mutate it.
