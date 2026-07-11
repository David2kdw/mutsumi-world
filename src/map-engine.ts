import type {
  RoadNetwork, LocationsData, Coord, RouteResult,
  Position, RoadNode,
} from "./types.js";

export function distance(a: Coord, b: Coord): number {
  return Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
}

/**
 * 为每个地点找到最近的路网节点。
 */
export function getNodeForLocation(
  locationName: string,
  locations: LocationsData,
  network: RoadNetwork,
): string {
  const locCoord = locations[locationName]?.coord;
  if (!locCoord) throw new Error(`Unknown location: ${locationName}`);

  let closest = network.nodes[0].id;
  let closestDist = Infinity;
  for (const node of network.nodes) {
    const d = distance(locCoord, node.coord);
    if (d < closestDist) {
      closestDist = d;
      closest = node.id;
    }
  }
  return closest;
}

interface AdjacencyEntry { to: string; distance: number; }

export function buildAdjacency(network: RoadNetwork): Map<string, AdjacencyEntry[]> {
  const adj = new Map<string, AdjacencyEntry[]>();
  for (const node of network.nodes) {
    adj.set(node.id, []);
  }
  for (const edge of network.edges) {
    adj.get(edge.from)!.push({ to: edge.to, distance: edge.distance });
    adj.get(edge.to)!.push({ to: edge.from, distance: edge.distance });
  }
  return adj;
}

/**
 * Dijkstra 最短路径。返回路网节点 ID 序列 + 总距离。
 */
export function findRoute(
  network: RoadNetwork,
  locations: LocationsData,
  fromLocation: string,
  toLocation: string,
): RouteResult {
  const startNode = getNodeForLocation(fromLocation, locations, network);
  const endNode = getNodeForLocation(toLocation, locations, network);

  if (startNode === endNode) {
    return { nodes: [startNode], totalDistance: 0, estimatedMinutes: 0 };
  }

  const adj = buildAdjacency(network);
  const dist = new Map<string, number>();
  const prev = new Map<string, string | null>();

  for (const node of network.nodes) {
    dist.set(node.id, Infinity);
    prev.set(node.id, null);
  }
  dist.set(startNode, 0);

  const unvisited = new Set(network.nodes.map(n => n.id));

  while (unvisited.size > 0) {
    let current: string | null = null;
    let minDist = Infinity;
    for (const id of unvisited) {
      const d = dist.get(id)!;
      if (d < minDist) { minDist = d; current = id; }
    }
    if (current === null || current === endNode) break;
    unvisited.delete(current);

    for (const edge of adj.get(current) || []) {
      if (!unvisited.has(edge.to)) continue;
      const alt = dist.get(current)! + edge.distance;
      if (alt < dist.get(edge.to)!) {
        dist.set(edge.to, alt);
        prev.set(edge.to, current);
      }
    }
  }

  // 重建路径
  const nodes: string[] = [];
  let cursor: string | null = endNode;
  while (cursor !== null) {
    nodes.unshift(cursor);
    cursor = prev.get(cursor) ?? null;
  }

  const totalDistance = dist.get(endNode)!;
  const estimatedMinutes = Math.ceil(totalDistance / (1.2 * 60));

  return { nodes, totalDistance, estimatedMinutes };
}

/**
 * 计算 traveling 状态中某个 progress 时的实际坐标。
 * 在路网的两节点之间线性插值。
 */
export function getCoordAt(
  route: string[],
  progress: number,
  network: RoadNetwork,
): Coord {
  if (route.length <= 1) {
    return network.nodes.find(n => n.id === route[0])!.coord;
  }

  const nodeMap = new Map(network.nodes.map(n => [n.id, n.coord]));
  let traveled = 0;

  // 计算总距离
  const segments: { from: string; to: string; dist: number }[] = [];
  for (let i = 1; i < route.length; i++) {
    const fromCoord = nodeMap.get(route[i - 1])!;
    const toCoord = nodeMap.get(route[i])!;
    const d = distance(fromCoord, toCoord);
    segments.push({ from: route[i - 1], to: route[i], dist: d });
    traveled += d;
  }

  const targetDist = progress * traveled;
  let accumulated = 0;

  for (const seg of segments) {
    if (accumulated + seg.dist >= targetDist) {
      const segProgress = (targetDist - accumulated) / seg.dist;
      const fromCoord = nodeMap.get(seg.from)!;
      const toCoord = nodeMap.get(seg.to)!;
      return {
        x: fromCoord.x + (toCoord.x - fromCoord.x) * segProgress,
        y: fromCoord.y + (toCoord.y - fromCoord.y) * segProgress,
      };
    }
    accumulated += seg.dist;
  }

  // 到达终点
  return nodeMap.get(route[route.length - 1])!;
}

/**
 * 根据 elapsed 时间推进 traveling 的 progress。
 * 返回是否已到达目的地。
 */
export function advanceTraveling(
  position: Extract<Position, { type: "traveling" }>,
  elapsedMs: number,
  speedMps: number,
  routeDistance: number,
): { progress: number; arrived: boolean } {
  const elapsedSec = elapsedMs / 1000;
  const distTraveled = elapsedSec * speedMps;
  const newProgress = Math.min(1, position.progress + distTraveled / routeDistance);
  return { progress: newProgress, arrived: newProgress >= 1 };
}
