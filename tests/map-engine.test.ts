// src/map-engine.test.ts
import { describe, it } from "node:test";
import assert from "node:assert";
import { findRoute, distance, buildAdjacency, getNodeForLocation } from "../src/map-engine.js";
import type { RoadNetwork, LocationsData, Coord } from "../src/types.js";

// 使用 spec 中的路网数据做测试
const testNetwork: RoadNetwork = {
  nodes: [
    { id: "n1",  coord: { x: 0, y: 0 } },
    { id: "n4",  coord: { x: 100, y: 20 } },
    { id: "n5",  coord: { x: 120, y: 30 } },
  ],
  edges: [
    { from: "n1", to: "n4", distance: 100 },
    { from: "n4", to: "n5", distance: 25 },
  ],
};

const testLocations: LocationsData = {
  "若叶家": { coord: { x: 0, y: 0 }, area: "住宅区" },
  "校门":   { coord: { x: 120, y: 30 }, area: "月之森学园" },
};

describe("map-engine", () => {
  it("distance computes Euclidean distance", () => {
    const a: Coord = { x: 0, y: 0 };
    const b: Coord = { x: 3, y: 4 };
    assert.strictEqual(distance(a, b), 5);
  });

  it("buildAdjacency creates undirected adjacency list", () => {
    const adj = buildAdjacency(testNetwork);
    assert.ok(adj.has("n1"));
    assert.deepStrictEqual(adj.get("n1")!.map(e => e.to).sort(), ["n4"]);
    assert.deepStrictEqual(adj.get("n4")!.map(e => e.to).sort(), ["n1", "n5"]);
  });

  it("findRoute returns shortest path", () => {
    const result = findRoute(testNetwork, testLocations, "若叶家", "校门");
    assert.ok(result);
    assert.deepStrictEqual(result.nodes, ["n1", "n4", "n5"]);
    assert.strictEqual(result.totalDistance, 125);
  });

  it("findRoute returns direct for same location", () => {
    const result = findRoute(testNetwork, testLocations, "若叶家", "若叶家");
    assert.ok(result);
    assert.strictEqual(result.totalDistance, 0);
    assert.strictEqual(result.nodes.length, 1);
  });

  it("advancePosition moves from location to traveling", () => {
    // TODO: after movement system is built
  });
});
