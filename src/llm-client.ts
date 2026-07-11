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

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
  messages: ChatMessage[],
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
    throw new Error(
      "LLMClient: 未找到 API key。请设置 DEEPSEEK_API_KEY 环境变量，或传入 config.apiKey。",
    );
  }

  return {
    dmChat(systemPrompt: string): DMSession {
      const history: ChatMessage[] = [
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

        close() {
          closed = true;
          history.length = 0;
        },
      };
    },

    async complete(systemPrompt: string, userPrompt: string): Promise<string> {
      const messages: ChatMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ];

      return chatCompletion(resolved, messages);
    },
  };
}
