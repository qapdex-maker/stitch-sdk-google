import { parseResourceName } from "./utils.js";

/** Private Symbol used to store and lookup cache keys on resolved entities. */
const CACHE_KEY_SYMBOL = Symbol("stitch.cacheKey");

/** Extract all ID segments from a standard resource name (e.g. projects/123/screens/456) */
export function parseAllSegments(
  name: string,
  result: Record<string, string> = {},
): Record<string, string> {
  // Use indexOf for faster primitive check instead of includes
  if (!name || name.indexOf("/") === -1) return result;
  const parts = name.split("/");
  for (let i = 0; i < parts.length - 1; i += 2) {
    let key = parts[i];
    if (key.endsWith("s")) key = key.slice(0, -1);
    result[key + "Id"] = parts[i + 1];
  }
  return result;
}

export class EntityManager {
  private cache = new Map<string, any>();
  private client: any;

  constructor(client: any) {
    this.client = client;
  }

  /**
   * Resolves an entity instance, ensuring referential equality for the same ID.
   * Logic is driven by the generated schema's reference keys.
   */
  resolve<T>(
    EntityClass: new (...args: any[]) => T,
    referenceKeys: string[],
    data: any,
  ): T {
    let canonicalId = "";
    const parsedValues: Record<string, string> = {};

    if (typeof data === "string") {
      canonicalId = parseResourceName(data);
      parseAllSegments(data, parsedValues);
      // Fallback if data is just the bare ID
      if (!parsedValues[referenceKeys[referenceKeys.length - 1]]) {
        parsedValues[referenceKeys[referenceKeys.length - 1]] = canonicalId;
      }
    } else if (data && typeof data === "object") {
      if (data.name) {
        canonicalId = parseResourceName(data.name);
        parseAllSegments(data.name, parsedValues);
      } else {
        // Fallback to reading the last reference key or 'id'
        const lastKey = referenceKeys[referenceKeys.length - 1];
        canonicalId = data[lastKey] || data.id || "";
      }

      // Populate keys from data
      for (const key of referenceKeys) {
        if (data[key]) {
          parsedValues[key] = data[key];
        }
      }

      // If the last key is still missing, fallback to id or canonicalId
      const lastKey = referenceKeys[referenceKeys.length - 1];
      if (!parsedValues[lastKey]) {
        parsedValues[lastKey] = data.id || canonicalId;
      }
    }

    if (!canonicalId) {
      // In cases where we just get an empty object or something, fallback
      canonicalId = "unknown";
    }

    const className = EntityClass.name;
    const cacheKey = `${className}:${canonicalId}`;

    let instance = this.cache.get(cacheKey);
    if (instance !== undefined) {
      if (data && typeof data === "object") {
        instance.data = { ...instance.data, ...data };
      }
      return instance;
    }

    // Direct instantiation is restricted for users, but allowed here
    instance = new EntityClass(this.client, data) as any;

    // OPTIMIZATION: Attach the cache key via a Symbol property to enable O(1) disposal.
    (instance as any)[CACHE_KEY_SYMBOL] = cacheKey;

    // Assign reference keys dynamically based on parsed values
    for (const key of referenceKeys) {
      if (parsedValues[key]) {
        instance[key] = parsedValues[key];
      }
    }

    if (typeof instance.onCreate === "function") {
      instance.onCreate();
    }

    this.cache.set(cacheKey, instance);
    return instance;
  }

  /**
   * Disposes of a specific entity.
   */
  dispose(entity: any) {
    if (!entity) return;
    if (typeof entity.onDispose === "function") {
      entity.onDispose();
    }
    const cacheKey = entity[CACHE_KEY_SYMBOL];
    if (cacheKey !== undefined) {
      this.cache.delete(cacheKey);
    } else {
      // OPTIMIZATION: Avoid entries array allocations and use direct Map iteration as a fallback.
      for (const [key, val] of this.cache) {
        if (val === entity) {
          this.cache.delete(key);
          break;
        }
      }
    }
  }

  /**
   * Clears the entire identity map cache.
   */
  clear() {
    for (const val of this.cache.values()) {
      if (typeof val.onDispose === "function") {
        val.onDispose();
      }
    }
    this.cache.clear();
  }
}
