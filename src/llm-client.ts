export interface DMResponse {
  action: "move" | "stay" | "event" | "none";
  environment?: string;
  event?: {
    id: string;
    name: string;
    type?: string;
    rarity?: string;
    description?: string;
    location: string;
    status: string;
    tags?: string[];
    resolve_hint?: string;
    npc_optional?: string;
    npc_required?: string[];
    condition?: string;
    season?: string;
  };
  event_note?: string;
  resolve_event_id?: string;
  move_to?: string;
  departure_note?: string;
}

export interface LLMClient {
  dmChat(systemPrompt: string): DMSession;
  /** 从已保存的历史恢复 DM session（不重新发送系统提示词） */
  restoreDMSession(history: DMSessionMessage[]): DMSession;
  complete(systemPrompt: string, userPrompt: string): Promise<string>;
}

export interface DMSessionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DMSession {
  send(prompt: string): Promise<DMResponse>;
  /** 返回完整的对话历史（含系统提示词），用于持久化保存 */
  getHistory(): DMSessionMessage[];
  close(): void;
}

export interface LLMConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";

function getConfig(overrides?: Partial<LLMConfig>): LLMConfig {
  return {
    apiKey: overrides?.apiKey
      || process.env.DEEPSEEK_API_KEY
      || process.env.OPENAI_API_KEY
      || "",
    baseUrl: overrides?.baseUrl || DEFAULT_BASE_URL,
    model: overrides?.model || DEFAULT_MODEL,
  };
}

/**
 * 从 LLM 响应文本中解析 JSON。
 * 处理 markdown 代码块包裹、BOM、前后空白。
 */
function parseJSONResponse(text: string): DMResponse {
  let cleaned = text.trim();

  // 去掉 markdown 代码块包裹
  const fenceMatch = cleaned.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  }

  try {
    return JSON.parse(cleaned) as DMResponse;
  } catch {
    // 如果解析失败，返回 no-op
    return { action: "none", environment: cleaned.slice(0, 500) };
  }
}

/**
 * 调用 DeepSeek Chat Completions API（OpenAI 兼容格式）。
 */
async function chatCompletion(
  config: LLMConfig,
  messages: DMSessionMessage[],
): Promise<string> {
  const url = `${config.baseUrl}/v1/chat/completions`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `DeepSeek API error ${response.status}: ${response.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}`,
    );
  }

  const data = await response.json() as {
    choices: Array<{ message: { content: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * 创建 LLM 客户端。
 *
 * API key 读取优先级：config.apiKey → DEEPSEEK_API_KEY 环境变量 → OPENAI_API_KEY 环境变量
 * 默认 baseUrl: https://api.deepseek.com
 * 默认 model: deepseek-chat
 */
export function createLLMClient(config?: Partial<LLMConfig>): LLMClient {
  const resolved = getConfig(config);

  if (!resolved.apiKey) {
    // 返回 no-op 客户端，插件不崩溃。LLM 依赖的功能返回占位响应。
    const noopMsg = "（LLM 未配置：DEEPSEEK_API_KEY 环境变量未找到）";

    return {
      dmChat(): DMSession {
        const history: DMSessionMessage[] = [];
        return {
          async send(): Promise<DMResponse> {
            return { action: "none", environment: noopMsg };
          },
          getHistory(): DMSessionMessage[] {
            return history;
          },
          close() {},
        };
      },
      restoreDMSession(history: DMSessionMessage[]): DMSession {
        return {
          async send(): Promise<DMResponse> {
            return { action: "none", environment: noopMsg };
          },
          getHistory(): DMSessionMessage[] {
            return history;
          },
          close() {},
        };
      },
      async complete(): Promise<string> {
        return noopMsg;
      },
    };
  }

  return {
    dmChat(systemPrompt: string): DMSession {
      const history: DMSessionMessage[] = [
        { role: "system", content: systemPrompt },
      ];

      let closed = false;

      return {
        async send(prompt: string): Promise<DMResponse> {
          if (closed) throw new Error("DMSession is closed");

          history.push({ role: "user", content: prompt });

          const text = await chatCompletion(resolved, history);

          history.push({ role: "assistant", content: text });

          return parseJSONResponse(text);
        },

        getHistory(): DMSessionMessage[] {
          return history;
        },

        close() {
          closed = true;
          history.length = 0;
        },
      };
    },

    restoreDMSession(history: DMSessionMessage[]): DMSession {
      let closed = false;

      return {
        async send(prompt: string): Promise<DMResponse> {
          if (closed) throw new Error("DMSession is closed");

          history.push({ role: "user", content: prompt });

          const text = await chatCompletion(resolved, history);

          history.push({ role: "assistant", content: text });

          return parseJSONResponse(text);
        },

        getHistory(): DMSessionMessage[] {
          return history;
        },

        close() {
          closed = true;
        },
      };
    },

    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
      const messages: DMSessionMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];

      return chatCompletion(resolved, messages);
    },
  };
}
