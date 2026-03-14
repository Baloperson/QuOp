export function createStore(options = {}) {
    // ==================== STORAGE ====================
    const items = new Map()              // id -> item
    const indexes = new Map()             // type/spatial -> Set<id>
    const listeners = new Map()            // event -> Set<callback>
    let transactionStack = []               // nested transactions
    
    // ==================== CONFIG ====================
    const config = {
        idGenerator: () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        validateTypes: true,
        ...options
    }
    
    // ==================== DEFAULTS ====================
    const defaults = {
        graph: { x: 0, y: 0, width: 400, height: 300, equations: [] },
        viewport: { x: 0, y: 0, width: 800, height: 600, contains: [] },
        text: { x: 0, y: 0, width: 300, height: 200, content: '' },
        ...options.defaults
    }
    
    // ==================== PUBLIC API ====================
    
    function create(spec, props = {}) {
        // Batch creation
        if (Array.isArray(spec)) {
            return spec.map(s => create(
                Array.isArray(s) ? s[0] : s,
                Array.isArray(s) ? s[1] : {}
            ))
        }
        
        const type = spec
        const id = props.id || config.idGenerator()
        
        if (config.validateTypes && !defaults[type]) {
            console.warn(`Tinyset: Unknown type "${type}"`)
        }
        
        const item = {
            id,
            type,
            ...(defaults[type] || {}),
            ...props,
            created: Date.now(),
            modified: Date.now()
        }
        
        items.set(id, item)
        updateIndexes('add', item)
        emit('create', item)
        emit('change', { type: 'create', item })
        recordTransaction('create', { id, item: { ...item } })
        
        return item
    }
    
    function get(identifier, options = {}) {
        // All items
        if (identifier === undefined) {
            return Array.from(items.values())
        }
        
        // Get by type
        if (typeof identifier === 'string' && !items.has(identifier)) {
            return find(identifier, {}, options)
        }
        
        // Get multiple by IDs
        if (Array.isArray(identifier)) {
            return identifier.map(id => items.get(id)).filter(Boolean)
        }
        
        // Single by ID
        const item = items.get(identifier)
        if (!item) return options.exists ? false : null
        
        if (options.exists) return true
        if (options.raw) return item
        if (options.fields) {
            return Object.fromEntries(
                options.fields.map(f => [f, item[f]])
            )
        }
        
        return { ...item }
    }
    
    function set(target, propOrProps, value, options = {}) {
        // Batch array
        if (Array.isArray(target)) {
            return target.map(t => set(t, propOrProps, value, options))
        }
        
        // Object map { id: props }
        if (typeof target === 'object' && !Array.isArray(target)) {
            const results = {}
            for (const [id, props] of Object.entries(target)) {
                results[id] = set(id, props, null, options)
            }
            return results
        }
        
        // Single item
        const id = typeof target === 'string' ? target : target.id
        const item = items.get(id)
        if (!item) return null
        
        const oldItem = { ...item }
        const changes = {}
        
        if (typeof propOrProps === 'string' && value !== undefined) {
            // Relative update ('+50', '-20', '*2', '/2')
            if (typeof value === 'string' && '+-*/'.includes(value[0])) {
                const op = value[0]
                const amount = parseFloat(value.slice(1))
                const current = item[propOrProps] || 0
                
                if (op === '+') item[propOrProps] = current + amount
                else if (op === '-') item[propOrProps] = current - amount
                else if (op === '*') item[propOrProps] = current * amount
                else if (op === '/') item[propOrProps] = current / amount
                
                changes[propOrProps] = value
            }
            // Function update
            else if (typeof value === 'function') {
                item[propOrProps] = value(item[propOrProps])
                changes[propOrProps] = '(function)'
            }
            // Deep path
            else if (propOrProps.includes('.')) {
                const parts = propOrProps.split('.')
                const last = parts.pop()
                let obj = item
                for (const part of parts) {
                    obj = obj[part] || (obj[part] = {})
                }
                obj[last] = value
                changes[propOrProps] = value
            }
            // Normal assignment
            else {
                item[propOrProps] = value
                changes[propOrProps] = value
            }
        } else if (typeof propOrProps === 'object') {
            // Batch update
            Object.assign(changes, propOrProps)
            for (const [k, v] of Object.entries(propOrProps)) {
                set(id, k, v, { ...options, silent: true })
            }
        }
        
        item.modified = Date.now()
        
        // Update spatial index if position changed
        if (changes.x !== undefined || changes.y !== undefined) {
            updateIndexes('update', item, oldItem)
        }
        
        if (!options.silent) {
            emit('update', { id, old: oldItem, new: item, changes })
            emit('change', { type: 'update', id, old: oldItem, new: item })
        }
        
        recordTransaction('update', { id, old: oldItem, new: { ...item } })
        
        // Return rollback function
        return () => set(id, oldItem, null, { silent: true })
    }
    
    function remove(target, options = {}) {
        // Dry run
        if (options.dryRun) {
            if (typeof target === 'string') {
                return items.has(target) ? [target] : []
            }
            return Array.from(items.keys())
        }
        
        const deleted = []
        
        // Delete by type with condition
        if (typeof target === 'string' && !items.has(target)) {
            const toDelete = find(target, options.where || {})
            for (const item of toDelete) {
                if (deleteOne(item.id, options)) {
                    deleted.push(item)
                }
            }
            return deleted
        }
        
        // Delete by ID(s)
        const ids = Array.isArray(target) ? target : [target]
        for (const id of ids) {
            const item = items.get(id)
            if (item && deleteOne(id, options)) {
                deleted.push(item)
            }
        }
        
        return deleted
    }
    
    function find(type, criteria = {}, options = {}) {
        let results = Array.from(items.values())
            .filter(item => item.type === type)
        
        // Apply criteria
        if (Object.keys(criteria).length > 0) {
            results = results.filter(item => matchesCriteria(item, criteria))
        }
        
        // Spatial search
        if (criteria.near) {
            results = spatialSearch(results, criteria)
        }
        
        // Sorting
        if (options.sort) {
            results = sortResults(results, options.sort)
        }
        
        // Pagination
        if (options.limit) {
            const offset = options.offset || 0
            results = results.slice(offset, offset + options.limit)
        }
        
        // Return formats
        if (options.count) return results.length
        if (options.ids) return results.map(r => r.id)
        if (options.first) return results[0]
        if (options.last) return results[results.length - 1]
        
        return results
    }
    
    // ==================== TRANSACTIONS ====================
    
    function beginTransaction() {
        const tx = {
            id: Date.now(),
            operations: [],
            commit: () => {
                transactionStack = transactionStack.filter(t => t.id !== tx.id)
                emit('transaction', { type: 'commit', id: tx.id })
            },
            rollback: () => {
                for (let i = tx.operations.length - 1; i >= 0; i--) {
                    const op = tx.operations[i]
                    if (op.type === 'create') items.delete(op.id)
                    else if (op.type === 'update') items.set(op.id, op.old)
                    else if (op.type === 'delete') items.set(op.id, op.item)
                }
                transactionStack = transactionStack.filter(t => t.id !== tx.id)
                emit('transaction', { type: 'rollback', id: tx.id })
            }
        }
        
        transactionStack.push(tx)
        return tx
    }
    
    // ==================== EVENTS ====================
    
    function on(event, callback) {
        if (!listeners.has(event)) {
            listeners.set(event, new Set())
        }
        listeners.get(event).add(callback)
        return () => off(event, callback)
    }
    
    function off(event, callback) {
        listeners.get(event)?.delete(callback)
    }
    
    function emit(event, data) {
        listeners.get(event)?.forEach(cb => {
            try { cb(data) } catch (e) { console.error(e) }
        })
    }
    
    // ==================== INTERNALS ====================
    
    function matchesCriteria(item, criteria) {
        for (const [key, condition] of Object.entries(criteria)) {
            if (key === 'near' || key === 'maxDistance') continue
            
            const value = item[key]
            
            // Operator object
            if (condition && typeof condition === 'object') {
                if (condition.gt !== undefined && !(value > condition.gt)) return false
                if (condition.lt !== undefined && !(value < condition.lt)) return false
                if (condition.gte !== undefined && !(value >= condition.gte)) return false
                if (condition.lte !== undefined && !(value <= condition.lte)) return false
                if (condition.contains && !String(value).includes(condition.contains)) return false
                if (condition.in && !condition.in.includes(value)) return false
            }
            // Direct equality
            else if (value !== condition) {
                return false
            }
        }
        return true
    }
    
    function spatialSearch(items, { near, maxDistance = Infinity }) {
        const [targetX, targetY] = near
        
        return items
            .filter(item => {
                const dx = (item.x || 0) - targetX
                const dy = (item.y || 0) - targetY
                return Math.sqrt(dx*dx + dy*dy) <= maxDistance
            })
            .sort((a, b) => {
                const da = Math.hypot((a.x || 0) - targetX, (a.y || 0) - targetY)
                const db = Math.hypot((b.x || 0) - targetX, (b.y || 0) - targetY)
                return da - db
            })
    }
    
    function sortResults(items, sort) {
        if (typeof sort === 'string') {
            return items.sort((a, b) => (a[sort] || 0) - (b[sort] || 0))
        }
        if (Array.isArray(sort)) {
            return items.sort((a, b) => {
                for (const field of sort) {
                    const diff = (a[field] || 0) - (b[field] || 0)
                    if (diff !== 0) return diff
                }
                return 0
            })
        }
        return items
    }
    
    function deleteOne(id, options) {
        const item = items.get(id)
        if (!item) return false
        
        items.delete(id)
        updateIndexes('remove', item)
        
        if (!options.silent) {
            emit('delete', item)
            emit('change', { type: 'delete', item })
        }
        
        recordTransaction('delete', { id, item: { ...item } })
        
        return true
    }
    
    function recordTransaction(type, data) {
        const tx = transactionStack[transactionStack.length - 1]
        if (tx) {
            tx.operations.push({ type, ...data })
        }
    }
    
    function updateIndexes(action, item, oldItem) {
        // Spatial index (100x100 grid cells)
        if (!indexes.has('spatial')) {
            indexes.set('spatial', new Map())
        }
        const spatial = indexes.get('spatial')
        
        if (action === 'add' || action === 'update') {
            const key = `${Math.floor(item.x / 100)},${Math.floor(item.y / 100)}`
            if (!spatial.has(key)) spatial.set(key, new Set())
            spatial.get(key).add(item.id)
        }
        
        if (action === 'remove' || action === 'update') {
            const oldKey = `${Math.floor(oldItem?.x / 100)},${Math.floor(oldItem?.y / 100)}`
            spatial.get(oldKey)?.delete(item.id)
        }
        
        // Type index
        if (!indexes.has('type')) {
            indexes.set('type', new Map())
        }
        const typeIndex = indexes.get('type')
        if (!typeIndex.has(item.type)) {
            typeIndex.set(item.type, new Set())
        }
        
        if (action === 'add') {
            typeIndex.get(item.type).add(item.id)
        } else if (action === 'remove') {
            typeIndex.get(item.type)?.delete(item.id)
        } else if (action === 'update' && oldItem?.type !== item.type) {
            typeIndex.get(oldItem.type)?.delete(item.id)
            typeIndex.get(item.type).add(item.id)
        }
    }
    
    function clear() {
        items.clear()
        indexes.clear()
        emit('clear')
    }
    
    // ==================== RETURN ====================
    
    return {
        create,
        get,
        set,
        remove,
        find,
        beginTransaction,
        on,
        off,
        clear,
        _debug: { items, indexes }
    }
}
