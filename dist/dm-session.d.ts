import type { WorldState } from "./types.js";
import { loadLocations, loadRoadNetwork, loadNPCs } from "./data-loader.js";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
export declare function recoverFromCrash(dataDir: string, locations: ReturnType<typeof loadLocations>, network: ReturnType<typeof loadRoadNetwork>, npcs: ReturnType<typeof loadNPCs>): Promise<WorldState | null>;
export declare function startDMScheduler(api: OpenClawPluginApi, dataDir: string): {
    stop: () => void;
    handleObserve: () => Promise<string>;
    handleMoveTo: (location: string, reason?: string) => Promise<string>;
};
