import type { LLMClient } from "./llm-client.js";
export declare function generateDiary(dataDir: string, workspaceDir: string, llmClient: LLMClient, soulPath: string): Promise<void>;
