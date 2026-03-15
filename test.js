// tinyset.js test suite
// usage: node --test test.js

import { describe, it, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createStore, where } from './tinyset.js'

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeStore(opts) {
  return createStore(opts)
}

// ─── core API ─────────────────────────────────────────────────────────────────

describe('create', () => {
  it('returns the created entity with id, type, created, modified', () => {
    const store = makeStore()
    const e = store.create('enemy', { hp: 50 })
    assert.ok(e.id)
    assert.equal(e.type, 'enemy')
    assert.equal(e.hp, 50)
    assert.ok(typeof e.created === 'number')
    assert.ok(typeof e.modified === 'number')
  })

  it('assigns sequential string ids by default', () => {
    const store = makeStore()
    const a = store.create('x', {})
    const b = store.create('x', {})
    assert.equal(typeof a.id, 'string')
    assert.notEqual(a.id, b.id)
  })

  it('respects a custom idGenerator', () => {
    let n = 0
    const store = makeStore({ idGenerator: () => `custom-${++n}` })
    const e = store.create('x', {})
    assert.equal(e.id, 'custom-1')
  })

  it('respects an explicit id in props', () => {
    const store = makeStore()
    const e = store.create('x', { id: 'my-id' })
    assert.equal(e.id, 'my-id')
  })

  it('applies type defaults', () => {
    const store = makeStore({ defaults: { enemy: { hp: 30, alive: true } } })
    const e = store.create('enemy', {})
    assert.equal(e.hp, 30)
    assert.equal(e.alive, true)
  })

  it('prop values override defaults', () => {
    const store = makeStore({ defaults: { enemy: { hp: 30 } } })
    const e = store.create('enemy', { hp: 99 })
    assert.equal(e.hp, 99)
  })

  it('throws on invalid type when types set is provided', () => {
    const store = makeStore({ types: new Set(['player']) })
    assert.throws(() => store.create('enemy', {}), /Invalid type/)
  })

  it('does not throw for valid type', () => {
    const store = makeStore({ types: new Set(['player']) })
    assert.doesNotThrow(() => store.create('player', {}))
  })
})

describe('createMany', () => {
  it('creates multiple entities and returns them all', () => {
    const store = makeStore()
    const items = store.createMany('enemy', [{ hp: 10 }, { hp: 20 }, { hp: 30 }])
    assert.equal(items.length, 3)
    assert.equal(items[0].hp, 10)
    assert.equal(items[2].hp, 30)
    assert.equal(store.count('enemy'), 3)
  })
})

describe('get / getRef / pick / exists', () => {
  it('get returns a shallow copy', () => {
    const store = makeStore()
    const e = store.create('x', { val: 1 })
    const got = store.get(e.id)
    assert.deepEqual(got, e)
    got.val = 999
    assert.equal(store.get(e.id).val, 1)
  })

  it('getRef returns the live object', () => {
    const store = makeStore()
    const e = store.create('x', { val: 1 })
    const ref = store.getRef(e.id)
    store.update(e.id, { val: 2 })
    assert.equal(ref.val, 2) 
  })

  it('get returns null for unknown id', () => {
    const store = makeStore()
    assert.equal(store.get('nope'), null)
  })

  it('pick returns only the requested fields', () => {
    const store = makeStore()
    const e = store.create('x', { a: 1, b: 2, c: 3 })
    const p = store.pick(e.id, ['a', 'c'])
    assert.deepEqual(p, { a: 1, c: 3 })
  })

  it('pick returns null for unknown id', () => {
    const store = makeStore()
    assert.equal(store.pick('nope', ['a']), null)
  })

  it('exists returns true/false correctly', () => {
    const store = makeStore()
    const e = store.create('x', {})
    assert.equal(store.exists(e.id), true)
    assert.equal(store.exists('nope'), false)
  })
})

describe('update', () => {
  it('merges changes and updates modified timestamp', async () => {
    const store = makeStore()
    const e = store.create('x', { a: 1, b: 2 })
    const before = e.modified
    await new Promise(r => setTimeout(r, 2))
    store.update(e.id, { a: 99 })
    const updated = store.get(e.id)
    assert.equal(updated.a, 99)
    assert.equal(updated.b, 2) // unchanged
    assert.ok(updated.modified > before)
  })

  it('supports a functional updater', () => {
    const store = makeStore()
    const e = store.create('x', { hp: 100 })
    store.update(e.id, old => ({ hp: old.hp - 10 }))
    assert.equal(store.get(e.id).hp, 90)
  })

  it('returns null for unknown id', () => {
    const store = makeStore()
    assert.equal(store.update('nope', { a: 1 }), null)
  })
})

describe('set', () => {
  it('sets a single field', () => {
    const store = makeStore()
    const e = store.create('x', { hp: 10 })
    store.set(e.id, 'hp', 50)
    assert.equal(store.get(e.id).hp, 50)
  })

  it('returns null for unknown id', () => {
    const store = makeStore()
    assert.equal(store.set('nope', 'hp', 1), null)
  })
})

describe('increment', () => {
  it('increments a field by default step of 1', () => {
    const store = makeStore()
    const e = store.create('x', { score: 10 })
    store.increment(e.id, 'score')
    assert.equal(store.get(e.id).score, 11)
  })

  it('increments by a custom step', () => {
    const store = makeStore()
    const e = store.create('x', { score: 10 })
    store.increment(e.id, 'score', 5)
    assert.equal(store.get(e.id).score, 15)
  })

  it('treats missing field as 0', () => {
    const store = makeStore()
    const e = store.create('x', {})
    store.increment(e.id, 'score')
    assert.equal(store.get(e.id).score, 1)
  })
})

describe('delete / deleteMany', () => {
  it('delete removes the entity and returns it', () => {
    const store = makeStore()
    const e = store.create('x', { val: 42 })
    const deleted = store.delete(e.id)
    assert.equal(deleted.val, 42)
    assert.equal(store.exists(e.id), false)
  })

  it('delete returns null for unknown id', () => {
    const store = makeStore()
    assert.equal(store.delete('nope'), null)
  })

  it('deleteMany removes all listed ids', () => {
    const store = makeStore()
    const a = store.create('x', {})
    const b = store.create('x', {})
    const c = store.create('x', {})
    store.deleteMany([a.id, b.id])
    assert.equal(store.exists(a.id), false)
    assert.equal(store.exists(b.id), false)
    assert.equal(store.exists(c.id), true)
  })
})

describe('clear', () => {
  it('removes everything and returns the count', () => {
    const store = makeStore()
    store.create('x', {}); store.create('y', {})
    const count = store.clear()
    assert.equal(count, 2)
    assert.equal(store.stats().items, 0)
  })
})

describe('dump / stats', () => {
  it('dump returns a plain object of shallow copies', () => {
    const store = makeStore()
    const e = store.create('x', { val: 1 })
    const d = store.dump()
    assert.equal(typeof d, 'object')
    assert.ok(!('get' in d))
    assert.equal(d[e.id].val, 1)
    d[e.id].val = 999
    assert.equal(store.get(e.id).val, 1) 
  })

  it('stats returns correct item and type counts', () => {
    const store = makeStore()
    store.create('player', {}); store.create('enemy', {}); store.create('enemy', {})
    const s = store.stats()
    assert.equal(s.items, 3)
    assert.equal(s.types.player, 1)
    assert.equal(s.types.enemy, 2)
  })
})

describe('events', () => {
  it('fires create event', (t, done) => {
    const store = makeStore()
    store.on('create', ({ item }) => {
      assert.equal(item.type, 'x')
      done()
    })
    store.create('x', {})
  })

  it('fires update event with old and new', (t, done) => {
    const store = makeStore()
    const e = store.create('x', { val: 1 })
    store.on('update', ({ item, old }) => {
      assert.equal(item.val, 2)
      assert.equal(old.val, 1)
      done()
    })
    store.update(e.id, { val: 2 })
  })

  it('fires delete event', (t, done) => {
    const store = makeStore()
    const e = store.create('x', {})
    store.on('delete', ({ id }) => {
      assert.equal(id, e.id)
      done()
    })
    store.delete(e.id)
  })

  it('on returns an unsubscribe function that works', () => {
    const store = makeStore()
    let count = 0
    const off = store.on('create', () => count++)
    store.create('x', {})
    off()
    store.create('x', {})
    assert.equal(count, 1)
  })

  it('once fires exactly once', () => {
    const store = makeStore()
    let count = 0
    store.once('create', () => count++)
    store.create('x', {}); store.create('x', {})
    assert.equal(count, 1)
  })

  it('change event fires for all mutation types', () => {
    const store = makeStore()
    const types = []
    store.on('change', ({ type }) => types.push(type))
    const e = store.create('x', {})
    store.update(e.id, { val: 1 })
    store.delete(e.id)
    assert.deepEqual(types, ['create', 'update', 'delete'])
  })
})

describe('transaction', () => {
  it('commits all operations on success', () => {
    const store = makeStore()
    const a = store.create('x', { val: 1 })
    store.transaction(() => {
      store.update(a.id, { val: 2 })
      store.create('x', { val: 3 })
    })
    assert.equal(store.get(a.id).val, 2)
    assert.equal(store.count('x'), 2)
  })

  it('rolls back all operations on throw', () => {
    const store = makeStore()
    const a = store.create('x', { val: 1 })
    const originalCount = store.count('x')
    assert.throws(() => {
      store.transaction(() => {
        store.update(a.id, { val: 99 })
        store.create('x', { val: 3 })
        throw new Error('abort')
      })
    }, /abort/)
    assert.equal(store.get(a.id).val, 1)
    assert.equal(store.count('x'), originalCount)
  })
})

// ─── find / count / where ──────────────────────────────────────────────────────

describe('find', () => {
  let store
  beforeEach(() => {
    store = makeStore()
    store.create('enemy', { hp: 10, tier: 'normal', active: true })
    store.create('enemy', { hp: 50, tier: 'elite',  active: true })
    store.create('enemy', { hp: 80, tier: 'boss',   active: false })
    store.create('player', { hp: 100 })
  })

  it('find with no predicate returns all of that type', () => {
    assert.equal(store.find('enemy').count(), 3)
    assert.equal(store.find('player').count(), 1)
  })

  it('find returns empty for unknown type', () => {
    assert.equal(store.find('ghost').count(), 0)
  })

  it('inline predicate filters correctly', () => {
    const result = store.find('enemy', e => e.hp > 20).all()
    assert.equal(result.length, 2)
    assert.ok(result.every(e => e.hp > 20))
  })

  it('count shorthand', () => {
    assert.equal(store.count('enemy'), 3)
    assert.equal(store.count('enemy', e => e.active), 2)
  })

  it('sort ascending by field', () => {
    const sorted = store.find('enemy').sort('hp').all()
    assert.equal(sorted[0].hp, 10)
    assert.equal(sorted[2].hp, 80)
  })

  it('limit and offset', () => {
    const sorted = store.find('enemy').sort('hp').limit(2).all()
    assert.equal(sorted.length, 2)
    const offset = store.find('enemy').sort('hp').offset(1).all()
    assert.equal(offset.length, 2)
    assert.equal(offset[0].hp, 50)
  })

  it('first and last', () => {
    const q = store.find('enemy').sort('hp')
    assert.equal(q.first().hp, 10)
    assert.equal(q.last().hp, 80)
  })

  it('first returns null on empty result', () => {
    assert.equal(store.find('ghost').first(), null)
  })

  it('ids returns array of ids', () => {
    const ids = store.find('enemy').ids()
    assert.equal(ids.length, 3)
    ids.forEach(id => assert.equal(typeof id, 'string'))
  })
})

describe('where predicates', () => {
  let store
  beforeEach(() => {
    store = makeStore()
    store.create('item', { val: 5,  tier: 'common', name: 'Iron Sword',  tags: 'a' })
    store.create('item', { val: 20, tier: 'rare',   name: 'Silver Bow',  tags: 'b' })
    store.create('item', { val: 50, tier: 'epic',   name: 'Gold Shield', tags: 'c' })
  })

  it('where.eq', () => {
    assert.equal(store.find('item', where.eq('tier', 'rare')).count(), 1)
  })

  it('where.ne', () => {
    assert.equal(store.find('item', where.ne('tier', 'rare')).count(), 2)
  })

  it('where.gt', () => {
    assert.equal(store.find('item', where.gt('val', 10)).count(), 2)
  })

  it('where.gte', () => {
    assert.equal(store.find('item', where.gte('val', 20)).count(), 2)
  })

  it('where.lt', () => {
    assert.equal(store.find('item', where.lt('val', 20)).count(), 1)
  })

  it('where.lte', () => {
    assert.equal(store.find('item', where.lte('val', 20)).count(), 2)
  })

  it('where.in', () => {
    const r = store.find('item', where.in('tier', ['common', 'epic'])).all()
    assert.equal(r.length, 2)
  })

  it('where.contains', () => {
    assert.equal(store.find('item', where.contains('name', 'Sword')).count(), 1)
  })

  it('where.startsWith', () => {
    assert.equal(store.find('item', where.startsWith('name', 'Gold')).count(), 1)
  })

  it('where.endsWith', () => {
    assert.equal(store.find('item', where.endsWith('name', 'Bow')).count(), 1)
  })

  it('where.exists', () => {
    store.create('item', { val: 1 }) // no tags field
    assert.equal(store.find('item', where.exists('tags')).count(), 3)
  })

  it('where.and', () => {
    const r = store.find('item', where.and(where.gt('val', 10), where.eq('tier', 'rare'))).all()
    assert.equal(r.length, 1)
    assert.equal(r[0].tier, 'rare')
  })

  it('where.or', () => {
    const r = store.find('item', where.or(where.eq('tier', 'common'), where.eq('tier', 'epic'))).all()
    assert.equal(r.length, 2)
  })

  it('nested where.and + where.or', () => {
    const r = store.find('item', where.and(
      where.or(where.eq('tier', 'common'), where.eq('tier', 'rare')),
      where.lt('val', 25)
    )).all()
    assert.equal(r.length, 2)
    assert.ok(r.every(i => i.val < 25))
  })
})

// ─── query cache ──────────────────────────────────────────────────────────────

describe('query cache correctness', () => {
  it('cached result matches uncached result', () => {
    const store = makeStore()
    for (let i = 0; i < 100; i++)
      store.create('enemy', { hp: i, tier: i % 2 === 0 ? 'elite' : 'normal' })

    const pred = where.and(where.eq('tier', 'elite'), where.gt('hp', 40))

    // first call — cold miss, populates cold cache
    const r1 = store.find('enemy', pred).all()
    // second and third — promotes to hot cache on third hit
    store.find('enemy', pred).all()
    const r3 = store.find('enemy', pred).all()
    // fourth — should be served from hot cache
    const r4 = store.find('enemy', pred).all()

    assert.deepEqual(r1.map(e => e.id).sort(), r3.map(e => e.id).sort())
    assert.deepEqual(r1.map(e => e.id).sort(), r4.map(e => e.id).sort())
  })

  it('cache is invalidated after a write to the same type', () => {
    const store = makeStore()
    for (let i = 0; i < 20; i++)
      store.create('enemy', { hp: i })

    const pred = where.gt('hp', 15)
    const before = store.find('enemy', pred).count()
    store.find('enemy', pred).count() 
    store.find('enemy', pred).count()
    store.find('enemy', pred).count() 

    store.create('enemy', { hp: 99 }) 

    const after = store.find('enemy', pred).count()
    assert.equal(after, before + 1)
  })

  it('write to type A does not invalidate cache for type B', () => {
    const store = makeStore()
    for (let i = 0; i < 10; i++) store.create('player', { score: i })
    for (let i = 0; i < 10; i++) store.create('enemy', { hp: i })

    const pred = where.gt('score', 5)
    // warm up player cache to hot
    store.find('player', pred).count()
    store.find('player', pred).count()
    store.find('player', pred).count()
    const countBefore = store.find('player', pred).count()

    // write to enemy — should NOT affect player cache
    store.create('enemy', { hp: 99 })
    store.update(store.find('enemy').first().id, { hp: 0 })

    const countAfter = store.find('player', pred).count()
    assert.equal(countAfter, countBefore)
  })

  it('cache is invalidated after delete', () => {
    const store = makeStore()
    const items = []
    for (let i = 0; i < 10; i++) items.push(store.create('item', { val: i }))

    const pred = where.gt('val', 5)
    store.find('item', pred).count()
    store.find('item', pred).count()
    store.find('item', pred).count()

    store.delete(items[9].id) 

    const count = store.find('item', pred).count()
    assert.equal(count, 3) // val 6,7,8 remain above 5
  })

  it('cache is invalidated after update changes predicate match', () => {
    const store = makeStore()
    const e = store.create('enemy', { hp: 10 })
    for (let i = 0; i < 5; i++) store.create('enemy', { hp: 100 })

    const pred = where.gt('hp', 50)
    store.find('enemy', pred).count()
    store.find('enemy', pred).count()
    store.find('enemy', pred).count() 

    store.update(e.id, { hp: 200 }) 

    assert.equal(store.find('enemy', pred).count(), 6)
  })

  it('inline predicates (no _key) still return correct results', () => {
    const store = makeStore()
    for (let i = 0; i < 20; i++) store.create('item', { val: i })

    const pred = i => i.val > 10 // no _key — ref-keyed cold cache only
    const r1 = store.find('item', pred).count()
    store.create('item', { val: 99 })
    const r2 = store.find('item', pred).count()

    assert.equal(r2, r1 + 1)
  })

  it('compound with untagged predicate (ne) does not get a _key', () => {
    // where.ne has no _key — compound containing it has _key=null
    // should still return correct results via ref-keyed path
    const store = makeStore()
    store.create('item', { tier: 'rare' })
    store.create('item', { tier: 'common' })
    store.create('item', { tier: 'epic' })

    const pred = where.and(where.ne('tier', 'rare'), where.ne('tier', 'common'))
    const r = store.find('item', pred).all()
    assert.equal(r.length, 1)
    assert.equal(r[0].tier, 'epic')
  })
})

// ─── spatial index ────────────────────────────────────────────────────────────

describe('spatial index', () => {
  let store

  beforeEach(() => {
    store = makeStore({ spatialGridSize: 100 })
    store.create('enemy', { x: 110, y: 210, hp: 50, label: 'close' })
    store.create('enemy', { x: 150, y: 200, hp: 30, label: 'medium' })
    store.create('enemy', { x: 400, y: 400, hp: 80, label: 'far' })
    store.create('player', { x: 100, y: 200 })
  })

  it('near returns only entities within radius', () => {
    const result = store.near('enemy', 100, 200, 60).all()
    const labels = result.map(e => e.label)
    assert.ok(labels.includes('close'))
    assert.ok(labels.includes('medium'))
    assert.ok(!labels.includes('far'))
  })

  it('near returns results sorted by distance ascending', () => {
    const result = store.near('enemy', 100, 200, 200).all()
    assert.equal(result[0].label, 'close')
    assert.equal(result[1].label, 'medium')
  })

  it('near does not return entities of a different type', () => {
    
    const result = store.near('enemy', 100, 200, 500).all()
    assert.ok(result.every(e => e.type === 'enemy'))
  })

  it('near with predicate filters results', () => {
    
    const result = store.near('enemy', 100, 200, 200, e => e.hp > 40).all()
    assert.equal(result.length, 1)
    assert.equal(result[0].label, 'close')
  })

  it('near returns empty array when nothing is in range', () => {
    const result = store.near('enemy', 0, 0, 5).all()
    assert.equal(result.length, 0)
  })

  it('near returns empty for unknown type', () => {
    assert.equal(store.near('ghost', 100, 200, 500).count(), 0)
  })

  it('spatial index updates when entity moves', () => {
    const e = store.find('enemy', where.eq('label', 'far')).first()
    // move far enemy to be close
    store.update(e.id, { x: 105, y: 205 })
    const result = store.near('enemy', 100, 200, 20).all()
    assert.ok(result.some(r => r.id === e.id))
  })

  it('spatial index removes entity on delete', () => {
    const e = store.find('enemy', where.eq('label', 'close')).first()
    store.delete(e.id)
    const result = store.near('enemy', 100, 200, 60).all()
    assert.ok(!result.some(r => r.id === e.id))
  })

  it('entities without x/y are not in spatial index', () => {
    const noPos = store.create('enemy', { label: 'nopos', hp: 10 })
    const result = store.near('enemy', 200, 300, 1000).all()
    assert.ok(!result.some(r => r.id === noPos.id))
   
    assert.ok(store.find('enemy', where.eq('label', 'nopos')).first())
  })

  it('works correctly across grid cell boundaries', () => {
  
    const s = makeStore({ spatialGridSize: 100 })
    s.create('unit', { x: 99, y: 0, label: 'left' })
    s.create('unit', { x: 101, y: 0, label: 'right' })
    const result = s.near('unit', 100, 0, 10).all()
    assert.equal(result.length, 2)
  })

  it('stats reflects spatial index correctly', () => {
    const s = store.stats()
    assert.ok(s.spatial.coords >= 3) 
  })
})
