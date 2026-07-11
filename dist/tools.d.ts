import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
export declare function registerTools(api: OpenClawPluginApi, scheduler: ReturnType<typeof import("./dm-session.js").startDMScheduler>, dataDir: string): void;
