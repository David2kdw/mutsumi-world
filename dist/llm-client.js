/**
 * 创建 LLM 客户端。具体实现取决于 OpenClaw 提供的 API。
 *
 * 实现要点：
 * 1. DM session 需要在 07:00 创建，次日 07:00 销毁
 * 2. 每次 send() 要携带之前的上下文
 * 3. DM prompt 中要求返回结构化 JSON，本 client 负责解析
 * 4. 使用 rules.json 中的 tone 和 style 指令
 */
export function createLLMClient(_api) {
    return {
        dmChat(_systemPrompt) {
            return {
                async send(_prompt) {
                    return { action: "none" };
                },
                close() { },
            };
        },
        async complete(_systemPrompt, _userPrompt) {
            return "(LLM 客户端尚未配置)";
        },
    };
}
