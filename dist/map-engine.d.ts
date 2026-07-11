import type { RoadNetwork, LocationsData, Coord, RouteResult, Position } from "./types.js";
export declare function distance(a: Coord, b: Coord): number;
/**
 * 为每个地点找到最近的路网节点。
 */
export declare function getNodeForLocation(locationName: string, locations: LocationsData, network: RoadNetwork): string;
interface AdjacencyEntry {
    to: string;
    distance: number;
}
export declare function buildAdjacency(network: RoadNetwork): Map<string, AdjacencyEntry[]>;
/**
 * Dijkstra 最短路径。返回路网节点 ID 序列 + 总距离。
 */
export declare function findRoute(network: RoadNetwork, locations: LocationsData, fromLocation: string, toLocation: string): RouteResult;
/**
 * 计算 traveling 状态中某个 progress 时的实际坐标。
 * 在路网的两节点之间线性插值。
 */
export declare function getCoordAt(route: string[], progress: number, network: RoadNetwork): Coord;
/**
 * 根据 elapsed 时间推进 traveling 的 progress。
 * 返回是否已到达目的地。
 */
export declare function advanceTraveling(position: Extract<Position, {
    type: "traveling";
}>, elapsedMs: number, speedMps: number, routeDistance: number): {
    progress: number;
    arrived: boolean;
};
export {};
