import { describe, it, expect } from "vitest";
import { EntityManager, parseAllSegments } from "../../src/entity-manager.js";

class DummyEntity {
  id: string;
  projectId: string;
  data: any;
  constructor(client: any, data: any) {
    this.data = data;
  }
}

describe("parseAllSegments", () => {
  it("should parse multiple segments correctly", () => {
    const result = parseAllSegments("projects/p1/screens/s2/variants/v3");
    expect(result).toEqual({
      projectId: "p1",
      screenId: "s2",
      variantId: "v3",
    });
  });

  it("should parse resource name with trailing slash", () => {
    const result = parseAllSegments("projects/p1/");
    expect(result).toEqual({
      projectId: "p1",
    });
  });

  it("should return empty object if no slash or empty name", () => {
    expect(parseAllSegments("")).toEqual({});
    expect(parseAllSegments("abc123")).toEqual({});
  });

  it("should handle odd/dangling keys or slash patterns", () => {
    expect(parseAllSegments("projects/p1/screens")).toEqual({
      projectId: "p1",
    });
  });
});

describe("EntityManager", () => {
  it("should return the same instance for a given ID (referential equality)", () => {
    const manager = new EntityManager({});
    const refKeys = ["projectId", "id"];

    const instance1 = manager.resolve(DummyEntity, refKeys, {
      id: "123",
      projectId: "p1",
    });
    const instance2 = manager.resolve(DummyEntity, refKeys, {
      id: "123",
      projectId: "p1",
    });
    const instance3 = manager.resolve(DummyEntity, refKeys, "123");

    expect(instance1).toBe(instance2);
    expect(instance1).toBe(instance3);
  });

  it("should populate reference keys from complex string correctly", () => {
    const manager = new EntityManager({});
    const refKeys = ["projectId", "id"];

    const instance = manager.resolve(
      DummyEntity,
      refKeys,
      "projects/p1/dummies/123",
    );
    expect(instance.id).toBe("123");
    expect(instance.projectId).toBe("p1");
  });

  it("should clear the cache", () => {
    const manager = new EntityManager({});
    const instance1 = manager.resolve(DummyEntity, ["id"], "123");
    manager.clear();
    const instance2 = manager.resolve(DummyEntity, ["id"], "123");

    expect(instance1).not.toBe(instance2);
  });

  it("should dispose of a specific entity in O(1) time and use fallback if Symbol is missing", () => {
    const manager = new EntityManager({});
    const refKeys = ["projectId", "id"];

    const instance1 = manager.resolve(DummyEntity, refKeys, {
      id: "123",
      projectId: "p1",
    });

    // Check that we can resolve it from cache
    const cachedInstance = manager.resolve(DummyEntity, refKeys, {
      id: "123",
      projectId: "p1",
    });
    expect(cachedInstance).toBe(instance1);

    // Dispose of the entity (should be O(1) using Symbol)
    manager.dispose(instance1);

    // Assert that the instance is removed from the cache Map
    const resolvedAgain = manager.resolve(DummyEntity, refKeys, {
      id: "123",
      projectId: "p1",
    });
    expect(resolvedAgain).not.toBe(instance1);

    // Verify O(N) fallback if Symbol is stripped/deleted from the instance
    const instance2 = manager.resolve(DummyEntity, refKeys, {
      id: "456",
      projectId: "p1",
    });

    // Delete all symbols from the instance to trigger the O(N) fallback path
    const symbols = Object.getOwnPropertySymbols(instance2);
    for (const sym of symbols) {
      delete (instance2 as any)[sym];
    }

    manager.dispose(instance2);

    // Check that instance2 was still successfully disposed/deleted from cache
    const resolvedAgain2 = manager.resolve(DummyEntity, refKeys, {
      id: "456",
      projectId: "p1",
    });
    expect(resolvedAgain2).not.toBe(instance2);
  });

  it("should correctly handle lazy parsing and verify correctness for cached entity hits", () => {
    const manager = new EntityManager({});
    const refKeys = ["projectId", "id"];

    // First resolution (cache miss)
    const instance1 = manager.resolve(
      DummyEntity,
      refKeys,
      "projects/p1/dummies/123",
    );
    expect(instance1.id).toBe("123");
    expect(instance1.projectId).toBe("p1");

    // Second resolution (cache hit with string name)
    const instance2 = manager.resolve(
      DummyEntity,
      refKeys,
      "projects/p1/dummies/123",
    );
    expect(instance2).toBe(instance1);

    // Third resolution (cache hit with object containing name)
    const instance3 = manager.resolve(DummyEntity, refKeys, {
      name: "projects/p1/dummies/123",
    });
    expect(instance3).toBe(instance1);
  });
});
