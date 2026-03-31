// QuOp.js test suite
// usage: node --test test.js

import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createStore, where } from './QuOp.js'

function makeStore(opts) { return createStore(opts) }

describe('create', () => {
  it('returns the created entity with id, type, created, modified', () => {
    const store = makeStore(); const e = store.create('item', { val: 50 })
    assert.ok(e.id); assert.equal(e.type, 'item'); assert.equal(e.val, 50)
    assert.ok(typeof e.created === 'number'); assert.ok(typeof e.modified === 'number')
  })
  it('assigns sequential string ids by default', () => {
    const store = makeStore(); const a = store.create('x', {}); const b = store.create('x', {})
    assert.equal(typeof a.id, 'string'); assert.notEqual(a.id, b.id)
  })
  it('respects a custom idGenerator', () => {
    let n=0; const store = makeStore({ idGenerator: ()=>`custom-${++n}` })
    assert.equal(store.create('x', {}).id, 'custom-1')
  })
  it('respects an explicit id in props', () => {
    assert.equal(makeStore().create('x', { id:'my-id' }).id, 'my-id')
  })
  it('applies type defaults', () => {
    const store = makeStore({ defaults:{ item:{ val:30, active:true } } })
    const e = store.create('item', {}); assert.equal(e.val, 30); assert.equal(e.active, true)
  })
  it('prop values override defaults', () => {
    assert.equal(makeStore({ defaults:{ item:{ val:30 } } }).create('item', { val:99 }).val, 99)
  })
  it('throws on invalid type when types set is provided', () => {
    assert.throws(()=>makeStore({ types:new Set(['record']) }).create('item',{}), /Invalid type/)
  })
  it('does not throw for valid type', () => {
    assert.doesNotThrow(()=>makeStore({ types:new Set(['record']) }).create('record',{}))
  })
})

describe('createMany', () => {
  it('creates multiple entities and returns them all', () => {
    const store = makeStore()
    const items = store.createMany('item', [{val:10},{val:20},{val:30}])
    assert.equal(items.length, 3); assert.equal(items[0].val, 10); assert.equal(store.count('item'), 3)
  })
})

describe('get / getRef / pick / exists', () => {
  it('get returns a shallow copy', () => {
    const store = makeStore(); const e = store.create('x', { val:1 }); const got = store.get(e.id)
    got.val = 999; assert.equal(store.get(e.id).val, 1)
  })
  it('getRef returns the live object', () => {
    const store = makeStore(); const e = store.create('x', { val:1 }); const ref = store.getRef(e.id)
    store.update(e.id, { val:2 }); assert.equal(ref.val, 2)
  })
  it('get returns null for unknown id', () => { assert.equal(makeStore().get('nope'), null) })
  it('pick returns only the requested fields', () => {
    const store = makeStore(); const e = store.create('x', { a:1, b:2, c:3 })
    assert.deepEqual(store.pick(e.id, ['a','c']), { a:1, c:3 })
  })
  it('pick returns null for unknown id', () => { assert.equal(makeStore().pick('nope', ['a']), null) })
  it('exists returns true/false correctly', () => {
    const store = makeStore(); const e = store.create('x', {})
    assert.equal(store.exists(e.id), true); assert.equal(store.exists('nope'), false)
  })
})

describe('update', () => {
  it('merges changes and updates modified timestamp', async () => {
    const store = makeStore(); const e = store.create('x', { a:1, b:2 }); const before = e.modified
    await new Promise(r=>setTimeout(r,2)); store.update(e.id, { a:99 })
    const u = store.get(e.id); assert.equal(u.a, 99); assert.equal(u.b, 2); assert.ok(u.modified > before)
  })
  it('supports a functional updater', () => {
    const store = makeStore(); const e = store.create('x', { val:100 })
    store.update(e.id, old=>({ val: old.val - 10 })); assert.equal(store.get(e.id).val, 90)
  })
  it('returns null for unknown id', () => { assert.equal(makeStore().update('nope', {a:1}), null) })
})

describe('set / increment / delete / clear / dump / stats', () => {
  it('set sets a single field', () => {
    const store = makeStore(); const e = store.create('x', { val:10 })
    store.set(e.id, 'val', 50); assert.equal(store.get(e.id).val, 50)
  })
  it('increment by 1 and by custom step', () => {
    const store = makeStore(); const e = store.create('x', { score:10 })
    store.increment(e.id, 'score'); assert.equal(store.get(e.id).score, 11)
    store.increment(e.id, 'score', 5); assert.equal(store.get(e.id).score, 16)
  })
  it('increment treats missing field as 0', () => {
    const store = makeStore(); const e = store.create('x', {})
    store.increment(e.id, 'score'); assert.equal(store.get(e.id).score, 1)
  })
  it('delete removes the entity and returns it', () => {
    const store = makeStore(); const e = store.create('x', { val:42 })
    const del = store.delete(e.id); assert.equal(del.val, 42); assert.equal(store.exists(e.id), false)
  })
  it('delete returns null for unknown id', () => { assert.equal(makeStore().delete('nope'), null) })
  it('deleteMany removes all listed ids', () => {
    const store = makeStore(); const a=store.create('x',{}), b=store.create('x',{}), c=store.create('x',{})
    store.deleteMany([a.id,b.id]); assert.equal(store.exists(a.id), false); assert.equal(store.exists(c.id), true)
  })
  it('clear removes everything and returns count', () => {
    const store = makeStore(); store.create('x',{}); store.create('y',{})
    assert.equal(store.clear(), 2); assert.equal(store.stats().items, 0)
  })
  it('dump returns plain object with shallow copies', () => {
    const store = makeStore(); const e = store.create('x', { val:1 }); const d = store.dump()
    d[e.id].val = 999; assert.equal(store.get(e.id).val, 1)
  })
  it('stats returns correct counts', () => {
    const store = makeStore(); store.create('record',{}); store.create('item',{}); store.create('item',{})
    const s = store.stats(); assert.equal(s.items, 3); assert.equal(s.types.item, 2)
  })
})

describe('events', () => {
  it('fires create event', (t, done) => {
    const store = makeStore(); store.on('create', ({item})=>{ assert.equal(item.type,'x'); done() }); store.create('x',{})
  })
  it('fires update event with old and new', (t, done) => {
    const store = makeStore(); const e = store.create('x', { val:1 })
    store.on('update', ({item,old})=>{ assert.equal(item.val,2); assert.equal(old.val,1); done() })
    store.update(e.id, { val:2 })
  })
  it('fires delete event', (t, done) => {
    const store = makeStore(); const e = store.create('x',{})
    store.on('delete', ({id})=>{ assert.equal(id,e.id); done() }); store.delete(e.id)
  })
  it('on returns unsubscribe that works', () => {
    const store = makeStore(); let count=0; const off = store.on('create',()=>count++)
    store.create('x',{}); off(); store.create('x',{}); assert.equal(count,1)
  })
  it('once fires exactly once', () => {
    const store = makeStore(); let count=0; store.once('create',()=>count++)
    store.create('x',{}); store.create('x',{}); assert.equal(count,1)
  })
  it('change event fires for all mutation types', () => {
    const store = makeStore(); const types=[]; store.on('change',({type})=>types.push(type))
    const e = store.create('x',{}); store.update(e.id,{val:1}); store.delete(e.id)
    assert.deepEqual(types, ['create','update','delete'])
  })
})

describe('transaction', () => {
  it('commits all operations on success', () => {
    const store = makeStore(); const a = store.create('x', { val:1 })
    store.transaction(()=>{ store.update(a.id,{val:2}); store.create('x',{val:3}) })
    assert.equal(store.get(a.id).val, 2); assert.equal(store.count('x'), 2)
  })
  it('rolls back all operations on throw', () => {
    const store = makeStore(); const a = store.create('x', { val:1 })
    assert.throws(()=>store.transaction(()=>{ store.update(a.id,{val:99}); store.create('x',{val:3}); throw new Error('abort') }), /abort/)
    assert.equal(store.get(a.id).val, 1); assert.equal(store.count('x'), 1)
  })
})

describe('find / count / where', () => {
  let store
  beforeEach(() => {
    store = makeStore()
    store.create('item', { val:10, name:'alpha', active:true  })
    store.create('item', { val:50, name:'beta',  active:true  })
    store.create('item', { val:80, name:'gamma', active:false })
    store.create('record', { val:100 })
  })
  it('no predicate returns all of type', () => { assert.equal(store.find('item').count(),3) })
  it('returns empty for unknown type', () => { assert.equal(store.find('unknown').count(),0) })
  it('inline predicate filters', () => { assert.equal(store.find('item',e=>e.val>20).all().length,2) })
  it('count shorthand', () => { assert.equal(store.count('item'),3); assert.equal(store.count('item',e=>e.active),2) })
  it('sort', () => { const s=store.find('item').sort('val').all(); assert.equal(s[0].val,10); assert.equal(s[2].val,80) })
  it('limit and offset', () => {
    assert.equal(store.find('item').sort('val').limit(2).all().length, 2)
    assert.equal(store.find('item').sort('val').offset(1).all()[0].val, 50)
  })
  it('first and last', () => { const q=store.find('item').sort('val'); assert.equal(q.first().val,10); assert.equal(q.last().val,80) })
  it('first returns null on empty', () => { assert.equal(store.find('unknown').first(),null) })
  it('ids returns array of ids', () => { assert.equal(store.find('item').ids().length,3) })

  it('where.eq', () => { assert.equal(store.find('item',where.eq('active',true)).count(),2) })
  it('where.ne', () => { assert.equal(store.find('item',where.ne('active',true)).count(),1) })
  it('where.gt', () => { assert.equal(store.find('item',where.gt('val',10)).count(),2) })
  it('where.gte', () => { assert.equal(store.find('item',where.gte('val',50)).count(),2) })
  it('where.lt', () => { assert.equal(store.find('item',where.lt('val',50)).count(),1) })
  it('where.lte', () => { assert.equal(store.find('item',where.lte('val',50)).count(),2) })
  it('where.in', () => { assert.equal(store.find('item',where.in('name',['alpha','gamma'])).count(),2) })
  it('where.contains', () => { assert.equal(store.find('item',where.contains('name','lph')).count(),1) })
  it('where.startsWith', () => { assert.equal(store.find('item',where.startsWith('name','alp')).count(),1) })
  it('where.endsWith', () => { assert.equal(store.find('item',where.endsWith('name','mma')).count(),1) })
  it('where.exists', () => {
    store.create('item',{ val:1 })  // no name
    assert.equal(store.find('item',where.exists('name')).count(),3)
  })
  it('where.and', () => { assert.equal(store.find('item',where.and(where.gt('val',10),where.eq('active',true))).count(),1) })
  it('where.or', () => { assert.equal(store.find('item',where.or(where.eq('active',true),where.gt('val',70))).count(),3) })
  it('nested and/or', () => {
    const r=store.find('item',where.and(where.or(where.eq('name','alpha'),where.eq('name','beta')),where.lt('val',60))).all()
    assert.equal(r.length,2); assert.ok(r.every(i=>i.val<60))
  })
})

describe('query cache correctness', () => {
  it('cached result matches fresh result', () => {
    const store = makeStore()
    for(let i=0;i<20;i++) store.create('item',{val:i})
    const pred = where.gt('val',10)
    const r1=store.find('item',pred).all()
    store.find('item',pred); store.find('item',pred)
    assert.deepEqual(r1.map(e=>e.id).sort(), store.find('item',pred).all().map(e=>e.id).sort())
  })
  it('invalidates after write to same type', () => {
    const store = makeStore()
    for(let i=0;i<10;i++) store.create('item',{val:i})
    const pred = where.gt('val',8)
    const before = store.find('item',pred).count()
    store.find('item',pred); store.find('item',pred); store.find('item',pred)
    store.create('item',{val:99})
    assert.equal(store.find('item',pred).count(), before+1)
  })
  it('write to type A does not invalidate type B cache', () => {
    const store = makeStore()
    for(let i=0;i<10;i++) store.create('record',{score:i})
    for(let i=0;i<10;i++) store.create('item',{val:i})
    const pred = where.gt('score',5)
    store.find('record',pred); store.find('record',pred); store.find('record',pred)
    const before = store.find('record',pred).count()
    store.create('item',{val:99})
    assert.equal(store.find('record',pred).count(), before)
  })
  it('invalidates after delete', () => {
    const store = makeStore(); const items=[]
    for(let i=0;i<10;i++) items.push(store.create('item',{val:i}))
    const pred = where.gt('val',5)
    store.find('item',pred); store.find('item',pred); store.find('item',pred)
    store.delete(items[9].id)
    assert.equal(store.find('item',pred).count(), 3)
  })
  it('invalidates after update changes match', () => {
    const store = makeStore()
    const e = store.create('item',{val:10})
    for(let i=0;i<5;i++) store.create('item',{val:100})
    const pred = where.gt('val',50)
    store.find('item',pred); store.find('item',pred); store.find('item',pred)
    store.update(e.id,{val:200})
    assert.equal(store.find('item',pred).count(), 6)
  })
  it('inline predicates return correct results after write', () => {
    const store = makeStore()
    for(let i=0;i<10;i++) store.create('item',{val:i})
    const pred = i=>i.val>8
    const before = store.find('item',pred).count()
    store.create('item',{val:99})
    assert.equal(store.find('item',pred).count(), before+1)
  })
  it('compound with untagged pred falls back to ref-keyed path correctly', () => {
    const store = makeStore()
    store.create('item',{status:'a'}); store.create('item',{status:'b'}); store.create('item',{status:'c'})
    const pred = where.and(where.ne('status','a'), where.ne('status','b'))
    assert.equal(store.find('item',pred).count(), 1)
    assert.equal(store.find('item',pred).first().status, 'c')
  })
})

describe('spatial index', () => {
  let store
  beforeEach(() => {
    store = makeStore({ spatialGridSize:100 })
    store.create('item', { x:110, y:210, val:50, label:'close'  })
    store.create('item', { x:150, y:200, val:30, label:'medium' })
    store.create('item', { x:400, y:400, val:80, label:'far'    })
    store.create('record', { x:100, y:200 })
  })
  it('returns only entities within radius', () => {
    const labels = store.near('item',100,200,60).all().map(e=>e.label)
    assert.ok(labels.includes('close')); assert.ok(!labels.includes('far'))
  })
  it('returns results sorted by distance', () => {
    const r = store.near('item',100,200,200).all()
    assert.equal(r[0].label,'close'); assert.equal(r[1].label,'medium')
  })
  it('does not return different type', () => {
    assert.ok(store.near('item',100,200,500).all().every(e=>e.type==='item'))
  })
  it('near with predicate filters', () => {
    assert.equal(store.near('item',100,200,200,e=>e.val>40).all().length, 1)
  })
  it('returns empty when nothing in range', () => { assert.equal(store.near('item',0,0,5).count(),0) })
  it('returns empty for unknown type', () => { assert.equal(store.near('unknown',100,200,500).count(),0) })
  it('updates when entity moves', () => {
    const e = store.find('item',where.eq('label','far')).first()
    store.update(e.id,{x:105,y:205})
    assert.ok(store.near('item',100,200,20).all().some(r=>r.id===e.id))
  })
  it('removes entity on delete', () => {
    const e = store.find('item',where.eq('label','close')).first()
    store.delete(e.id)
    assert.ok(!store.near('item',100,200,60).all().some(r=>r.id===e.id))
  })
  it('entities without x/y not in spatial but findable', () => {
    const noPos = store.create('item',{label:'nopos',val:10})
    assert.ok(!store.near('item',200,300,1000).all().some(r=>r.id===noPos.id))
    assert.ok(store.find('item',where.eq('label','nopos')).first())
  })
  it('works across grid cell boundaries', () => {
    const s = makeStore({spatialGridSize:100})
    s.create('unit',{x:99,y:0,label:'left'}); s.create('unit',{x:101,y:0,label:'right'})
    assert.equal(s.near('unit',100,0,10).count(),2)
  })
  it('stats reflects spatial index', () => { assert.ok(store.stats().spatial.coords>=3) })
})

// ─── edge cases ───────────────────────────────────────────────────────────────
// These tests target boundaries and previously-fixed bugs.
// Each test name states the invariant — if it fails, something regressed.

describe('pick — nested mutation isolation', () => {
  it('mutating a picked object field does not affect the stored entity', () => {
    const store = makeStore()
    const e = store.create('x', { stats: { hp: 100, mp: 50 } })
    const p = store.pick(e.id, ['stats'])
    p.stats.hp = 0
    assert.equal(store.getRef(e.id).stats.hp, 100)
  })

  it('mutating a picked array field does not affect the stored entity', () => {
    const store = makeStore()
    const e = store.create('x', { tags: ['a', 'b'] })
    const p = store.pick(e.id, ['tags'])
    p.tags.push('c')
    assert.equal(store.getRef(e.id).tags.length, 2)
  })

  it('primitive fields in pick are independent by value', () => {
    const store = makeStore()
    const e = store.create('x', { score: 10 })
    const p = store.pick(e.id, ['score'])
    p.score = 999
    assert.equal(store.get(e.id).score, 10)
  })
})

describe('batch API', () => {
  it('batch.update applies all changes', () => {
    const store = makeStore()
    const ids = [store.create('x',{v:1}).id, store.create('x',{v:2}).id, store.create('x',{v:3}).id]
    store.batch.update(ids.map(id => ({ id, changes: { v: 99 } })))
    ids.forEach(id => assert.equal(store.get(id).v, 99))
  })

  it('batch.update fires one batch event, not per-item update events', () => {
    const store = makeStore()
    const ids = [store.create('x',{v:1}).id, store.create('x',{v:2}).id]
    let updateFired = 0, batchFired = 0
    store.on('update', () => updateFired++)
    store.on('batch',  e => { if (e.op === 'update') batchFired++ })
    store.batch.update(ids.map(id => ({ id, changes: { v: 0 } })))
    assert.equal(updateFired, 0)
    assert.equal(batchFired, 1)
  })

  it('batch.delete fires one batch event, not per-item delete events', () => {
    const store = makeStore()
    const ids = [store.create('x',{}).id, store.create('x',{}).id, store.create('x',{}).id]
    let deleteFired = 0, batchFired = 0
    store.on('delete', () => deleteFired++)
    store.on('batch',  e => { if (e.op === 'delete') batchFired++ })
    store.batch.delete(ids)
    assert.equal(deleteFired, 0)
    assert.equal(batchFired, 1)
    ids.forEach(id => assert.equal(store.exists(id), false))
  })

  it('batch.update inside a transaction rolls back on throw', () => {
    const store = makeStore()
    const e = store.create('x', { v: 1 })
    assert.throws(() => store.transaction(() => {
      store.batch.update([{ id: e.id, changes: { v: 999 } }])
      throw new Error('abort')
    }), /abort/)
    assert.equal(store.get(e.id).v, 1)
  })

  it('batch.delete inside a transaction rolls back on throw', () => {
    const store = makeStore()
    const a = store.create('x', { v: 1 })
    const b = store.create('x', { v: 2 })
    assert.throws(() => store.transaction(() => {
      store.batch.delete([a.id, b.id])
      throw new Error('abort')
    }), /abort/)
    assert.equal(store.count('x'), 2)
    assert.equal(store.find('x', where.eq('v', 1)).count(), 1)
  })

  it('batch.create is an alias for createMany', () => {
    const store = makeStore()
    const items = store.batch.create('item', [{ v: 10 }, { v: 20 }])
    assert.equal(items.length, 2)
    assert.equal(store.count('item'), 2)
  })
})

describe('transaction — rollback completeness', () => {
  it('delete rollback restores to find(), not just exists()', () => {
    const store = makeStore()
    const e = store.create('item', { val: 42 })
    assert.throws(() => store.transaction(() => {
      store.delete(e.id)
      throw new Error('abort')
    }), /abort/)
    assert.equal(store.exists(e.id), true)
    assert.equal(store.find('item').count(), 1)
    assert.equal(store.find('item', where.eq('val', 42)).count(), 1)
  })

  it('delete rollback restores spatial index', () => {
    const store = makeStore({ spatialGridSize: 100 })
    const e = store.create('item', { x: 100, y: 100 })
    assert.throws(() => store.transaction(() => {
      store.delete(e.id)
      throw new Error('abort')
    }), /abort/)
    assert.equal(store.near('item', 100, 100, 10).count(), 1)
  })

  it('create rollback leaves no phantom type entries', () => {
    const store = makeStore()
    store.create('existing', { v: 1 })
    assert.throws(() => store.transaction(() => {
      store.create('phantom', { v: 2 })
      throw new Error('abort')
    }), /abort/)
    const types = Object.keys(store.stats().types)
    assert.ok(!types.includes('phantom'))
    assert.ok(!types.includes('__none__'))
    assert.equal(types.length, 1)
  })

  it('mixed rollback (create + update + delete) fully restores', () => {
    const store = makeStore()
    const a = store.create('x', { v: 1 })
    const b = store.create('x', { v: 2 })
    assert.throws(() => store.transaction(() => {
      store.update(a.id, { v: 99 })
      store.delete(b.id)
      store.create('x', { v: 3 })
      throw new Error('abort')
    }), /abort/)
    assert.equal(store.get(a.id).v, 1)
    assert.equal(store.exists(b.id), true)
    assert.equal(store.count('x'), 2)
  })
})

describe('type validation', () => {
  it('update with invalid type throws before mutating', () => {
    const store = makeStore({ types: new Set(['a', 'b']) })
    const e = store.create('a', { v: 1, label: 'original' })
    assert.throws(() => store.update(e.id, { type: 'invalid', label: 'mutated' }), /Invalid type/)
    assert.equal(store.get(e.id).label, 'original')
    assert.equal(store.get(e.id).type, 'a')
  })

  it('valid type change succeeds', () => {
    const store = makeStore({ types: new Set(['a', 'b']) })
    const e = store.create('a', { v: 1 })
    store.update(e.id, { type: 'b' })
    assert.equal(store.get(e.id).type, 'b')
    assert.equal(store.find('b').count(), 1)
    assert.equal(store.find('a').count(), 0)
  })
})

describe('type change index consistency', () => {
  it('after type change, entity leaves old type index and joins new', () => {
    const store = makeStore()
    const e = store.create('enemy', { x: 100, y: 100 })
    store.update(e.id, { type: 'ally' })
    assert.equal(store.find('enemy').count(), 0)
    assert.equal(store.find('ally').count(), 1)
    assert.equal(store.find('ally').first().id, e.id)
  })

  it('after type change, spatial queries use the new type', () => {
    const store = makeStore({ spatialGridSize: 100 })
    const e = store.create('enemy', { x: 200, y: 200 })
    store.update(e.id, { type: 'ally' })
    assert.equal(store.near('enemy', 200, 200, 10).count(), 0)
    assert.equal(store.near('ally',  200, 200, 10).count(), 1)
  })
})

describe('query cache edge cases', () => {
  it('find with no predicate after write returns updated set', () => {
    const store = makeStore()
    store.create('item', { v: 1 }); store.create('item', { v: 2 })
    store.find('item').all(); store.find('item').all() // warm
    store.create('item', { v: 3 })
    assert.equal(store.find('item').count(), 3)
  })

  it('delete invalidates result from hot cache', () => {
    const store = makeStore()
    const items = Array.from({ length: 5 }, (_, i) => store.create('item', { v: i }))
    const pred = where.gt('v', 2)
    store.find('item', pred); store.find('item', pred)
    const before = store.find('item', pred).count()
    store.delete(items[4].id)
    assert.equal(store.find('item', pred).count(), before - 1)
  })

  it('batch.update invalidates cache for affected type', () => {
    const store = makeStore()
    const ids = Array.from({ length: 5 }, (_, i) => store.create('item', { v: i }).id)
    const pred = where.gt('v', 3)
    store.find('item', pred); store.find('item', pred)
    const before = store.find('item', pred).count()
    store.batch.update(ids.map(id => ({ id, changes: { v: 99 } })))
    assert.ok(store.find('item', pred).count() > before)
  })

  it('same predicate used on two types stays independent', () => {
    const store = makeStore()
    for (let i = 0; i < 5; i++) store.create('a', { v: i })
    for (let i = 0; i < 5; i++) store.create('b', { v: i })
    const pred = where.gt('v', 3)
    store.find('a', pred); store.find('b', pred)
    store.create('a', { v: 99 })
    assert.equal(store.find('a', pred).count(), 2)
    assert.equal(store.find('b', pred).count(), 1)
  })

  it('inline predicate result updates correctly after write to same type', () => {
    const store = makeStore()
    for (let i = 0; i < 10; i++) store.create('item', { v: i })
    const pred = e => e.v > 8
    const before = store.find('item', pred).count()
    store.create('item', { v: 99 })
    assert.equal(store.find('item', pred).count(), before + 1)
  })
})

describe('spatial edge cases', () => {
  it('entity exactly on radius boundary is included', () => {
    const store = makeStore({ spatialGridSize: 100 })
    store.create('item', { x: 100, y: 200 }) // distance exactly 100 from (0, 200)
    assert.equal(store.near('item', 0, 200, 100).count(), 1)
  })

  it('works with negative coordinates', () => {
    const store = makeStore({ spatialGridSize: 100 })
    store.create('item', { x: -50, y: -50 })
    assert.equal(store.near('item', -50, -50, 10).count(), 1)
    assert.equal(store.near('item',   0,   0, 10).count(), 0)
  })

  it('type change removes entity from old type spatial queries', () => {
    const store = makeStore({ spatialGridSize: 100 })
    const e = store.create('enemy', { x: 100, y: 100 })
    store.update(e.id, { type: 'ally' })
    assert.equal(store.near('enemy', 100, 100, 10).count(), 0)
    assert.equal(store.near('ally',  100, 100, 10).count(), 1)
  })

  it('moving entity between grid cells works correctly', () => {
    const store = makeStore({ spatialGridSize: 100 })
    const e = store.create('item', { x: 50, y: 50 })
    store.update(e.id, { x: 850, y: 850 })
    assert.equal(store.near('item',  50,  50, 10).count(), 0)
    assert.equal(store.near('item', 850, 850, 10).count(), 1)
  })
})

describe('find chain methods', () => {
  it('offset past end returns empty, not an error', () => {
    const store = makeStore()
    store.create('x', { v: 1 })
    assert.equal(store.find('x').offset(99).count(), 0)
    assert.equal(store.find('x').offset(99).first(), null)
  })

  it('limit(0) returns empty', () => {
    const store = makeStore()
    store.create('x', { v: 1 })
    assert.equal(store.find('x').limit(0).count(), 0)
  })

  it('sort on missing field groups missing with zeros', () => {
    const store = makeStore()
    store.create('x', { v: 5 }); store.create('x', {}); store.create('x', { v: 2 })
    const sorted = store.find('x').sort('v').all()
    // missing field is treated as 0 — comes before v:2 and v:5
    assert.equal(sorted[0].v, undefined)
    assert.equal(sorted[1].v, 2)
  })

  it('chained limit + offset', () => {
    const store = makeStore()
    for (let i = 0; i < 10; i++) store.create('x', { v: i })
    const result = store.find('x').sort('v').offset(3).limit(3).all()
    assert.equal(result.length, 3)
    assert.equal(result[0].v, 3)
    assert.equal(result[2].v, 5)
  })
})

describe('events edge cases', () => {
  it('handler error does not prevent other handlers from firing', () => {
    const store = makeStore()
    let secondFired = false
    store.on('create', () => { throw new Error('bad handler') })
    store.on('create', () => { secondFired = true })
    store.create('x', {})
    assert.equal(secondFired, true)
  })

  it('unsubscribing inside a handler does not break iteration', () => {
    const store = makeStore()
    let count = 0
    const off = store.on('create', () => { count++; off() })
    store.on('create', () => { count++ })
    store.create('x', {}); store.create('x', {})
    assert.equal(count, 3) // first create: both fire; second create: only the second
  })

  it('batch event carries correct op and count', () => {
    const store = makeStore()
    const ids = [store.create('x',{}).id, store.create('x',{}).id]
    let ev
    store.on('batch', e => ev = e)
    store.batch.delete(ids)
    assert.equal(ev.op, 'delete')
    assert.equal(ev.count, 2)
  })
})
