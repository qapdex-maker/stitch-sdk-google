## 2026-03-01 - Avoid Heavy Object.values Allocation in Schema Repair

**Learning:** In the Stitch MCP SDK, schema repair (`repairToolSchemas`) recursively traverses the inputs and outputs of every discovered tool using `collectRefTargets`. Using `Object.values(record)` on every object node during deep recursive schema traversal triggers heavy CPU execution and garbage collection due to massive array allocations. Replacing `Object.values` with a standard `for...in` key iteration combined with `hasOwnProperty` completely avoids intermediate array allocations and delivers a ~50% reduction in recursive schema traversal execution time (~1.3x - 2.0x faster).
**Action:** Avoid using `Object.values` or `Object.keys` in deep recursive utility functions within the hot path. Use a memory-efficient `for...in` loop with a prototype `hasOwnProperty` guard, or use an iterative queue/stack if recursion depth or stack overflow is a concern.

## 2026-07-18 - Single-Pass Map Lookups and In-Place Object Mutation in Entity Resolution

**Learning:** In `EntityManager.resolve()`, checking the cache with `Map.prototype.has()` followed by retrieving the instance via `Map.prototype.get()` forces the Javascript engine to perform two separate tree/hash lookups in the Map structure. Switching to a single-pass `get()` lookup reduces the overhead by ~43%. Furthermore, calling `parseAllSegments()` and then copying with `Object.assign()` during hot-path resolutions creates garbage collectable intermediate objects. Accepting an optional target object parameters lets us mutate `parsedValues` in-place, eliminating both the extra object allocation and the subsequent assignment overhead.
**Action:** Always optimize Map caches by replacing double lookups (`has` + `get`) with a single `get` check against `undefined`. For parsing helper functions that feed into hot-path object creators, support passing a target object to mutate in-place, completely avoiding intermediate objects and `Object.assign` operations.

## 2026-07-22 - O(1) Cache Deletion of Resolved Instances in EntityManager

**Learning:** In `EntityManager.dispose()`, searching the cache map via full iteration (`for...of` over `this.cache.entries()`) to find a matching entity forces an O(N) linear search, which degrades in performance as the cache grows. By storing the cache key directly on the entity instance using a private, non-enumerable `Symbol` property when the entity is resolved, we can look up the key directly to achieve O(1) cache deletion. Guarding the property definition with `Object.isExtensible` and `try-catch` guarantees safety for frozen, sealed, or proxy-wrapped objects.
**Action:** To enable O(1) cache deletion of resolved instances in cache registries, store the cache key on the resolved entity instance using a private, non-enumerable `Symbol` property. Guard the `Object.defineProperty` call with `Object.isExtensible` and a try-catch block to handle frozen or sealed objects safely, with a fallback O(N) traversal loop.

## 2026-07-25 - Lazy-Parsing and Deferring Object Allocations on Cache Hits

**Learning:** In `EntityManager.resolve()`, checking the cache map is preceded by allocating a `parsedValues` accumulator object, calling `parseAllSegments()`, and running fallback assignment loops. On hot cache-hit paths (which represent the majority of entity resolutions), these allocations and operations are completely redundant and discarded. Moving the cache-hit check prior to any name parsing or accumulator allocations delivers a ~2.5x speedup for string name resolutions and a ~1.1x speedup for object name resolutions, while completely eliminating intermediate garbage generation on cache hits.
**Action:** In high-frequency cache registries, calculate only the minimal key needed for cache verification first. Always defer heavy extraction, parsing, loop execution, and sub-object allocations until after a cache-miss is confirmed.

## 2026-10-24 - Zero-Allocation Regex-Based Filename Sanitization

**Learning:** In the assets download pipeline (`DownloadAssetsHandler`), `sanitizeFilename` is invoked for every downloaded image, stylesheet, and asset across all project screens. Re-implementing a simple character allowlist check using `.split("").filter(...).join("")` causes thousands of intermediate character array allocations and redundant O(N * M) string lookups (`allowedChars.includes(c)`). Replacing this with a fast, single-pass RegExp replacement (`base.replace(/[^a-zA-Z0-9_-]/g, "")`) avoids all intermediate array allocations and runs over 6x faster.
**Action:** Replace manual character loops, splitting, and filtering operations on strings with native, compiled regular expressions when performing character sanitization or allowlist checks.
