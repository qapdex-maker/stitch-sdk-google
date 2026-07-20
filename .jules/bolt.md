## 2026-03-01 - Avoid Heavy Object.values Allocation in Schema Repair

**Learning:** In the Stitch MCP SDK, schema repair (`repairToolSchemas`) recursively traverses the inputs and outputs of every discovered tool using `collectRefTargets`. Using `Object.values(record)` on every object node during deep recursive schema traversal triggers heavy CPU execution and garbage collection due to massive array allocations. Replacing `Object.values` with a standard `for...in` key iteration combined with `hasOwnProperty` completely avoids intermediate array allocations and delivers a ~50% reduction in recursive schema traversal execution time (~1.3x - 2.0x faster).
**Action:** Avoid using `Object.values` or `Object.keys` in deep recursive utility functions within the hot path. Use a memory-efficient `for...in` loop with a prototype `hasOwnProperty` guard, or use an iterative queue/stack if recursion depth or stack overflow is a concern.

## 2026-07-18 - Single-Pass Map Lookups and In-Place Object Mutation in Entity Resolution

**Learning:** In `EntityManager.resolve()`, checking the cache with `Map.prototype.has()` followed by retrieving the instance via `Map.prototype.get()` forces the Javascript engine to perform two separate tree/hash lookups in the Map structure. Switching to a single-pass `get()` lookup reduces the overhead by ~43%. Furthermore, calling `parseAllSegments()` and then copying with `Object.assign()` during hot-path resolutions creates garbage collectable intermediate objects. Accepting an optional target object parameters lets us mutate `parsedValues` in-place, eliminating both the extra object allocation and the subsequent assignment overhead.
**Action:** Always optimize Map caches by replacing double lookups (`has` + `get`) with a single `get` check against `undefined`. For parsing helper functions that feed into hot-path object creators, support passing a target object to mutate in-place, completely avoiding intermediate objects and `Object.assign` operations.

## 2026-07-20 - O(1) Cache Disposal via Symbol-keyed Cache Keys

**Learning:** In `EntityManager.dispose(entity)`, disposing of a cached entity previously required iterating over the entire cache's entries using `this.cache.entries()` in an O(N) linear scan, which also allocated intermediate entry arrays (`[key, value]`) for every resolved item. By assigning the Cache Key directly to the resolved entity instance using a private, non-enumerable JS `Symbol` property on resolution, we can look up and delete the cache entry in O(1) time without any array allocations.
**Action:** Store entity/item metadata or internal keys as Symbol-keyed properties directly on instances to enable O(1) lookups and deletions in managers or caches, rather than iterating through cache entries.
