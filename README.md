
A lightweight, isomorphic state container with built-in queries, transactions, and optional real-time synchronization.


TinySet provides a unified data layer that works identically in browsers, Node.js, and React Native. The core library handles local state with advanced querying; the optional `+` extension adds distributed features with causal consistency.

```
Core:    ~5kB  | 150 lines
Plus:    +4kB  | +25 lines
Total:   ~9kB 
```

## Installation

```bash
npm install tinyset
# or
yarn add tinyset
```

## Core Library (`tinyset`)

### Basic Usage

```javascript
import { createStore } from 'tinyset'

const store = createStore()

// Create items with type and properties
const graph = store.create('graph', { 
  x: 100, 
  y: 200, 
  width: 400, 
  height: 300 
})

// Retrieve by ID
const item = store.get(graph.id)

// Query by type with criteria
const results = store.find('graph', {
  x: { gt: 50, lt: 150 },
  y: { gte: 100 }
})

// Update properties
store.set(graph.id, 'width', 500)

// Listen to changes
const unsubscribe = store.on('create', (item) => {
  console.log('New item:', item)
})

// Remove items
store.remove(graph.id)
```

### API Reference

#### `createStore(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `idGenerator` | Function | UUID generator | Custom ID generation |
| `validateTypes` | Boolean | `true` | Warn on unknown types |
| `defaults` | Object | `{}` | Type-specific defaults |
| `processId`* | String | Random | Unique process identifier |

\* *Required for distributed features*

#### Core Methods

| Method | Description | Returns |
|--------|-------------|---------|
| `create(type, props)` | Create new item(s) | Item or array |
| `get(id)` | Retrieve by ID | Item or null |
| `get(type)` | Get all of type | Array |
| `get([ids])` | Get multiple | Array |
| `set(id, prop, value)` | Update property | Rollback function |
| `set(id, props)` | Batch update | Rollback function |
| `remove(id)` | Delete item(s) | Deleted items |
| `find(type, criteria, options)` | Query items | Array or count |
| `on(event, callback)` | Subscribe | Unsubscribe fn |
| `off(event, callback)` | Unsubscribe | - |

#### Query Operators

```javascript
// Comparison operators
{ age: { gt: 21 } }           // Greater than
{ age: { lt: 65 } }           // Less than
{ age: { gte: 18 } }          // Greater than or equal
{ age: { lte: 30 } }          // Less than or equal

// String operators
{ name: { contains: 'smith' } } // Substring match
{ status: { in: ['active', 'pending'] } } // Array inclusion

// Spatial operators
{ near: [x, y], maxDistance: 50 } // Distance-based
```

#### Query Options

```javascript
const results = store.find('graph', { x: { gt: 100 } }, {
  sort: 'x',                    // Sort by field
  sort: ['x', 'y'],             // Multi-field sort
  limit: 10,                    // Pagination limit
  offset: 20,                   // Pagination offset
  count: true,                   // Return count only
  ids: true,                     // Return IDs only
  first: true,                    // Return first match
  last: true                      // Return last match
})
```

#### Update Syntax

```javascript
// Relative updates (string operators)
store.set(id, 'x', '+50')        // Add 50
store.set(id, 'x', '-20')        // Subtract 20
store.set(id, 'x', '*2')         // Multiply by 2
store.set(id, 'x', '/2')         // Divide by 2

// Function updates
store.set(id, 'x', (prev) => prev + 50)

// Deep paths
store.set(id, 'user.address.city', 'London')

// Batch updates
store.set(id, { x: 100, y: 200, width: 500 })

// Multiple items
store.set([id1, id2], 'status', 'active')
```

#### Transactions

```javascript
const tx = store.beginTransaction()

try {
  store.set(item1.id, 'status', 'processing')
  store.set(item2.id, 'status', 'completed')
  store.remove(tempItem.id)
  
  tx.commit()  // Commit changes
} catch (error) {
  tx.rollback()  // Undo all changes
}
```

#### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `create` | `item` | Item created |
| `update` | `{id, old, new, changes}` | Item updated |
| `delete` | `item` | Item deleted |
| `change` | `{type, item}` | Any change |
| `clear` | - | Store cleared |

---

## Plus Extension (`tinyset+`)

Adds distributed capabilities while maintaining the same core API.

### Usage

```javascript
import { createStore } from 'tinyset/plus'

const store = createStore({
  processId: 'server-1'  // Required for distributed features
})

// Same core API as above, plus:
```

### Additional Features

#### Vector Clocks

```javascript
// Automatic causal consistency
store.create('graph', { x: 100 })  // Operation gets vector clock

// Manual clock inspection
const clock = store._debug.vectorClock
// { 'server-1': 5, 'client-2': 3, 'client-7': 12 }
```

#### Operation Journal

```javascript
// All operations are automatically logged
const journal = store._debug.journal

// Export operations since timestamp
const log = store.exportLog(1625097600000)

// Import operations from another instance
store.importLog(remoteLog, { 
  strategy: 'merge'  // or 'force'
})
```

#### Checkpoints

```javascript
// Create state snapshot (prunes journal)
const checkpoint = store.checkpoint()

// Checkpoint contains full state at that moment
// Journal now contains only operations after checkpoint
```

#### Synchronization

```javascript
// WebSocket sync
const disconnect = store.connect('ws://server:8080')

// Manual sync
const localLog = store.exportLog()
// Send over network...
remoteStore.importLog(localLog)

// Listen to journal for replication
const unsubscribe = store.onJournal((operation) => {
  // Broadcast to peers
  broadcast(operation)
})
```

#### Affine Operations

```javascript
import { AffineOp } from 'tinyset/plus'

// Create composable transformations
const translate = new AffineOp(1, 100)      // x → x + 100
const scale = new AffineOp(2, 0)            // x → 2x
const transform = translate.compose(scale)  // x → 2x + 100

// Apply to items
store.set(item.id, 'x', transform)

// Affine operations are journaled and synced like any other update
```

### Distributed API

| Method | Description |
|--------|-------------|
| `exportLog(since, options)` | Get operations since timestamp |
| `importLog(log, options)` | Apply remote operations |
| `connect(url)` | WebSocket connection to peer |
| `onJournal(callback)` | Listen to raw journal |
| `checkpoint()` | Create state snapshot |
| `AffineOp` | Tensor operation constructor |

### Sync Strategies

| Strategy | Behavior |
|----------|----------|
| `'merge'` | Apply if operation is newer (default) |
| `'force'` | Apply regardless of clock |
| `'dryRun'` | Test without applying |

---

## Examples

### Basic Todo App

```javascript
const store = createStore({
  defaults: {
    todo: { completed: false, text: '' }
  }
})

// Add todo
function addTodo(text) {
  return store.create('todo', { text })
}

// Toggle completion
function toggleTodo(id) {
  const todo = store.get(id)
  store.set(id, 'completed', !todo.completed)
}

// Get active todos
function getActiveTodos() {
  return store.find('todo', { completed: false })
}

// Listen for changes
store.on('change', render)
```

### Collaborative Whiteboard

```javascript
const store = createStore({
  processId: `user-${userId}`,
  defaults: {
    shape: { x: 0, y: 0, color: '#000' }
  }
})

// Connect to collaboration server
store.connect('wss://collab.example.com')

// Draw shape (auto-syncs to other users)
function drawShape(type, x, y) {
  store.create(type, { x, y })
}

// Move shape (updates in real-time)
function moveShape(id, dx, dy) {
  store.set(id, 'x', `+${dx}`)
  store.set(id, 'y', `+${dy}`)
}

// Find nearby shapes
function getShapesNear(x, y, radius) {
  return store.find('shape', {
    near: [x, y],
    maxDistance: radius
  })
}
```

### Offline-First Application

```javascript
const store = createStore({
  processId: 'offline-client'
})

// Work offline - operations are journaled
store.create('note', { content: 'Draft' })

// Later, when online:
if (navigator.onLine) {
  // Sync with server
  const localLog = store.exportLog()
  await fetch('/api/sync', {
    method: 'POST',
    body: JSON.stringify(localLog)
  })
}

// On reconnect, import server changes
async function syncFromServer() {
  const response = await fetch('/api/sync')
  const remoteLog = await response.json()
  store.importLog(remoteLog)
}
```

---

## Performance Characteristics

| Operation | Time Complexity | Notes |
|-----------|-----------------|-------|
| Create | O(1) | + index updates |
| Get by ID | O(1) | Direct map lookup |
| Update | O(1) | + index updates if position changes |
| Delete | O(1) | + index cleanup |
| Find (equality) | O(n) | Full scan without index |
| Find (spatial) | O(log n) | Grid-based spatial index |
| Transaction | O(ops) | Operations reversible |

**Memory**: Approximately 2x raw data size (items + indexes)

---

## Browser Support

Works in all modern browsers and Node.js 12+.

---

## License

MIT

---

## Comparison with Alternatives

| Feature | TinySet | Redux | MobX | Firebase |
|---------|---------|-------|------|----------|
| Bundle size | 5-7kB | 20kB+ | 15kB+ | 100kB+ |
| Learning curve | Low | High | Medium | Medium |
| Query support | Built-in | Manual | Manual | Limited |
| Spatial queries | Yes | No | No | No |
| Transactions | Yes | Via middleware | No | Yes |
| Time travel | Built-in | Via devtools | No | No |
| Offline support | Built-in | Add library | Add library | Add library |
| Real-time sync | Built-in | Add library | Add library | Built-in |
| Self-hostable | Yes | Yes | Yes | No |
| Isomorphic | Yes | Yes | Yes | Limited |

---

## Contributing

Issues and pull requests welcome.

---

*Documentation for TinySet v1.2*
