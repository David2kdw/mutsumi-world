export interface DMResponse {
    action: "move" | "stay" | "event" | "none";
    environment?: string;
    event?: {
        id: string;
        name: string;
        location: string;
        status: string;
    };
    event_note?: string;
    resolve_event_id?: string;
    move_to?: string;
    departure_note?: string;
}
export interface LLMClient {
    dmChat(systemPrompt: string): DMSession;
    complete(systemPrompt: string, userPrompt: string): Promise<string>;
}
export interface DMSession {
    send(prompt: string): Promise<DMResponse>;
    close(): void;
}
export interface LLMConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
}
/**
 * 创建 LLM 客户端。
 *
 * API key 读取优先级：config.apiKey → DEEPSEEK_API_KEY 环境变量 → OPENAI_API_KEY 环境变量
 * 默认 baseUrl: https://api.deepseek.com
 * 默认 model: deepseek-chat
 */
export declare function createLLMClient(config?: Partial<LLMConfig>): LLMClient;
