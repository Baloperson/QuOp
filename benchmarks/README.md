# TinySet Benchmarks

Two benchmark suites — one for the core library against competitors, one for the `tinyset+` distributed features.

## Setup

```bash
cd benchmarks
npm install
```

This installs the comparison libraries (LokiJS, Lodash, Immutable.js, RBush, Flatbush, NodeCache, MemoryCache, QuickLRU) as dev dependencies. They are not required to use TinySet itself.

Both benchmark files expect `tinyset.js` and `tinyset.plus.js` to be in the parent directory (`../tinyset.js`). If you've cloned the repo normally, this is already the case.

## Running

```bash
# Core benchmark — TinySet vs 8 competitors
node --expose-gc bench.js

# Distributed benchmark — tinyset+ journal, clocks, sync, affine ops
node --expose-gc bench.plus.js
```

The `--expose-gc` flag enables accurate memory measurements. Both files run without it — memory sections will be skipped.

## What each file tests

### bench.js

Compares TinySet against LokiJS, NodeCache, MemoryCache, QuickLRU, Lodash, Immutable.js, and raw Array/Object stores across:

- **Create** — 10,000 item insertions
- **Read** — 100,000 random reads (safe copy and live ref paths)
- **Update** — 50,000 field updates
- **Query** — simple and compound predicate queries, avg over 100 runs
- **Mixed workload** — 10,000 operations at 40% read / 20% update / 20% simple find / 20% compound find
- **Memory** — heap usage per 10,000 items (requires `--expose-gc`)
- **Spatial** — avg latency per query vs RBush and Flatbush

The mixed workload is the most representative benchmark. Real game loops and collaborative apps don't run isolated operations.

### bench.plus.js

Tests the distributed layer in `tinyset+`:

- **Journal** — write throughput, query latency (by time, process, type), checkpoint cost
- **Vector clocks** — increment (via create), snapshot, merge, current-read throughput
- **Sync** — operation generation speed, export/import throughput (in-process WebSocket mock)
- **Merge strategies** — ours, theirs, timestamp — with real conflicts
- **Affine operations** — single apply, batch apply, compose, inverse
- **Memory overhead** — tinyset+ vs base tinyset per item

## Reproducibility

Both suites use a seeded PRNG (mulberry32) so operation sequences are identical across runs. Results are reported as the median of 15 runs (`bench.js`) or 5 runs (`bench.plus.js`) to reduce noise.

Absolute numbers vary by machine. The relative ordering between libraries is stable. The numbers in the README were measured on an AMD FX-6350 running Node v24.

## Adding a comparison library

In `bench.js`, each library has a wrapper that exposes a consistent interface (`create`, `get`, `set`, `find`, `delete`). Add a new `try/catch` import block at the top and a wrapper in `buildLibraries()` following the existing pattern.
