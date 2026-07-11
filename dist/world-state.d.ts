import type { WorldState, TrajectoryEntry } from "./types.js";
export declare function createEmptyWorld(date: string, dayType: "weekday" | "saturday" | "sunday"): WorldState;
export declare function readWorld(dataDir: string): WorldState;
export declare function writeWorld(dataDir: string, state: WorldState): void;
export declare function appendTrajectory(state: WorldState, entry: TrajectoryEntry): void;
