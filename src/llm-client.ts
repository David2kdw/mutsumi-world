import type { OpenClawPluginApi } from "openclaw/plugin-sdk";

export interface DMResponse {
  action: "move" | "stay" | "event" | "none";
  environment?: string;         // 新的环境描述
  event?: {
    id: string;
    name: string;
    location: string;
    status: string;
  };
  event_note?: string;          // 追加到 trajectory
  resolve_event_id?: string;    // 要移除的事件 ID
  move_to?: string;             // 决定去哪个地点
  departure_note?: string;      // 出发时追加到 trajectory
}

export interface LLMClient {
  /** 创建新的 DM 每日 session */
  dmChat(systemPrompt: string): DMSession;
  /** 单次完成（用于日记等一次性任务） */
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

export interface DMSession {
  /** 发送 prompt 并获取结构化响应 */
  send(prompt: string): Promise<DMResponse>;
  /** 关闭 session */
  close(): void;
}

/**
 * 创建 LLM 客户端。具体实现取决于 OpenClaw 提供的 API。
 *
 * 实现要点：
 * 1. DM session 需要在 07:00 创建，次日 07:00 销毁
 * 2. 每次 send() 要携带之前的上下文
 * 3. DM prompt 中要求返回结构化 JSON，本 client 负责解析
 * 4. 使用 rules.json 中的 tone 和 style 指令
 */
export function createLLMClient(_api: OpenClawPluginApi): LLMClient {
  // TODO: 实现时探索 OpenClaw 的 LLM 调用机制
  // 可能的方式：
  //   A) OpenClaw 内部 API：api.runtime 上的某个方法
  //   B) OpenAI-compatible HTTP API（如果 OpenClaw 暴露）
  //   C) child_process 调用 openclaw CLI
  throw new Error("LLMClient implementation depends on OpenClaw API discovery");
}
