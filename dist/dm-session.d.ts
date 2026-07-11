import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
export declare function startDMScheduler(api: OpenClawPluginApi, dataDir: string): {
    stop: () => void;
    handleObserve: () => Promise<string>;
    handleMoveTo: (location: string, reason?: string) => Promise<string>;
};
