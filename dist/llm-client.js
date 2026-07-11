const DEFAULT_BASE_URL = "https://api.deepseek.com";
const DEFAULT_MODEL = "deepseek-v4-flash";
function getConfig(overrides) {
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
function parseJSONResponse(text) {
    let cleaned = text.trim();
    // 去掉 markdown 代码块包裹
    const fenceMatch = cleaned.match(/^```(?:json)?\s*\n([\s\S]*?)\n\s*```$/);
    if (fenceMatch) {
        cleaned = fenceMatch[1].trim();
    }
    try {
        return JSON.parse(cleaned);
    }
    catch {
        // 如果解析失败，返回 no-op
        return { action: "none", environment: cleaned.slice(0, 500) };
    }
}
/**
 * 调用 DeepSeek Chat Completions API（OpenAI 兼容格式）。
 */
async function chatCompletion(config, messages) {
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
        throw new Error(`DeepSeek API error ${response.status}: ${response.statusText}${body ? ` — ${body.slice(0, 300)}` : ""}`);
    }
    const data = await response.json();
    return data.choices?.[0]?.message?.content ?? "";
}
/**
 * 创建 LLM 客户端。
 *
 * API key 读取优先级：config.apiKey → DEEPSEEK_API_KEY 环境变量 → OPENAI_API_KEY 环境变量
 * 默认 baseUrl: https://api.deepseek.com
 * 默认 model: deepseek-chat
 */
export function createLLMClient(config) {
    const resolved = getConfig(config);
    if (!resolved.apiKey) {
        throw new Error("LLMClient: 未找到 API key。请设置 DEEPSEEK_API_KEY 环境变量，或传入 config.apiKey。");
    }
    return {
        dmChat(systemPrompt) {
            const history = [
                { role: "system", content: systemPrompt },
            ];
            let closed = false;
            return {
                async send(prompt) {
                    if (closed)
                        throw new Error("DMSession is closed");
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
        async complete(systemPrompt, userPrompt) {
            const messages = [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
            ];
            return chatCompletion(resolved, messages);
        },
    };
}
