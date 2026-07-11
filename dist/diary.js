import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { readWorld, writeWorld } from "./world-state.js";
/**
 * 从 OpenClaw 的 trajectory.jsonl 文件中解析当天的用户和助手消息。
 *
 * OpenClaw 会定期 reset/compact session——旧 session 保存为 .jsonl.reset.<timestamp>，
 * 新 session 从零开始。这里扫描 sessions 目录下所有 .trajectory.jsonl 和 .jsonl.reset.* 文件，
 * 按 ts 时间戳过滤出目标日期的消息。
 */
function parseDailyChatLog(dateStr) {
    const sessionsDir = path.join(os.homedir(), ".openclaw", "agents", "main", "sessions");
    const allLines = [];
    try {
        const files = fs.readdirSync(sessionsDir);
        // 收集所有 .trajectory.jsonl 文件（含 reset 备份）
        const trajFiles = files.filter(f => f.endsWith(".trajectory.jsonl"));
        for (const f of trajFiles) {
            const filePath = path.join(sessionsDir, f);
            try {
                const content = fs.readFileSync(filePath, "utf-8");
                allLines.push(...content.split("\n").filter(Boolean));
            }
            catch { /* skip */ }
        }
        // 也扫描 reset 备份（<uuid>.jsonl.reset.<timestamp>）
        const resetFiles = files.filter(f => f.includes(".jsonl.reset."));
        for (const f of resetFiles) {
            const filePath = path.join(sessionsDir, f);
            try {
                const content = fs.readFileSync(filePath, "utf-8");
                allLines.push(...content.split("\n").filter(Boolean));
            }
            catch { /* skip */ }
        }
    }
    catch {
        return "";
    }
    if (allLines.length === 0)
        return "";
    const userMessages = [];
    const assistantMessages = [];
    for (const line of allLines) {
        try {
            const entry = JSON.parse(line);
            // 检查时间戳是否在当天
            if (!entry.ts)
                continue;
            const entryDate = new Date(entry.ts).toISOString().slice(0, 10);
            if (entryDate !== dateStr)
                continue;
            if (entry.type === "prompt.submitted") {
                // 用户输入
                const promptText = entry.data?.prompt;
                if (promptText && typeof promptText === "string") {
                    // 清理 QQ 格式: [xxx] 前缀、(@你) 标记
                    const cleaned = promptText.replace(/\[.*?\]\s*/, "").replace(/\(@你\)/, "").trim();
                    if (cleaned)
                        userMessages.push(`群友: ${cleaned}`);
                }
            }
            else if (entry.type === "model.completed") {
                // 助手回复
                const texts = entry.data?.assistantTexts;
                if (Array.isArray(texts) && texts.length > 0) {
                    const content = texts.join("").trim();
                    if (content)
                        assistantMessages.push(`睦: ${content}`);
                }
            }
        }
        catch { /* skip malformed */ }
    }
    // 交错输出用户消息和助手消息
    const chatLines = [];
    const maxLines = Math.max(userMessages.length, assistantMessages.length);
    for (let i = 0; i < maxLines; i++) {
        if (i < userMessages.length)
            chatLines.push(userMessages[i]);
        if (i < assistantMessages.length)
            chatLines.push(assistantMessages[i]);
    }
    return chatLines.join("\n");
}
export async function generateDiary(dataDir, workspaceDir, llmClient, soulPath) {
    let state;
    try {
        state = readWorld(dataDir);
    }
    catch {
        return; // no world state yet
    }
    const trajectory = state._mutsumi.trajectory;
    if (trajectory.length === 0)
        return;
    const chatLog = parseDailyChatLog(state.date);
    const systemPrompt = fs.readFileSync(soulPath, "utf-8");
    const userPrompt = `今天结束了。请以若叶睦的口吻写一篇简短日记。

今天你的轨迹：
${trajectory.map(t => `- ${t.time} ${t.note}`).join("\n")}

${chatLog ? `今天和群友的对话：\n${chatLog}\n` : ""}

要求：话少、直白、1-5句。写今天发生了什么、感受如何。不写 AI 话。`;
    const diary = await llmClient.complete(systemPrompt, userPrompt);
    const diaryContent = `# ${state.date} 日记

${diary}

> 日记由睦子米在 23:30 自动撰写。独立于 QQ 对话。
`;
    // 双写
    const workspaceMemoryDir = path.join(workspaceDir, "memory");
    fs.mkdirSync(workspaceMemoryDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceMemoryDir, `${state.date}.md`), diaryContent, "utf-8");
    // 插件内部也存一份
    const pluginMemoryDir = path.join(dataDir, "diaries");
    fs.mkdirSync(pluginMemoryDir, { recursive: true });
    fs.writeFileSync(path.join(pluginMemoryDir, `${state.date}.md`), diaryContent, "utf-8");
    // 清空轨迹
    state._mutsumi.trajectory = [];
    writeWorld(dataDir, state);
}
