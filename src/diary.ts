import * as fs from "node:fs";
import * as path from "node:path";
import { readWorld } from "./world-state.js";
import type { LLMClient } from "./llm-client.js";
import type { WorldState } from "./types.js";

/**
 * 从所有 trajectory.jsonl 中解析当天的用户和助手消息。
 *
 * OpenClaw 会定期 reset/compact session——旧 session 保存为 .jsonl.reset.<timestamp>，
 * 新 session 从零开始。只看最新一个 session 会漏掉当天 reset 之前的消息和昨天的消息。
 * 所以这里扫描 sessions 目录下所有 .trajectory.jsonl 文件（包括 reset 前的），
 * 按 timestamp 过滤出目标日期的消息。
 */
function parseDailyChatLog(
  sessionsDir: string,
  dateStr: string,
): string {
  const allLines: string[] = [];

  try {
    const files = fs.readdirSync(sessionsDir);
    // 收集所有 .trajectory.jsonl 文件（含 reset 备份）
    const trajFiles = files.filter(f => f.endsWith(".trajectory.jsonl"));
    for (const f of trajFiles) {
      const filePath = path.join(sessionsDir, f);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        allLines.push(...content.split("\n").filter(Boolean));
      } catch {
        // 跳过无法读取的文件
      }
    }

    // 也扫描 reset 备份文件（<uuid>.jsonl.reset.<timestamp>）
    // 这些文件本身是 JSONL 格式，包含被 reset 的 session 的消息
    const resetFiles = files.filter(f => f.includes(".jsonl.reset."));
    for (const f of resetFiles) {
      const filePath = path.join(sessionsDir, f);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        allLines.push(...content.split("\n").filter(Boolean));
      } catch {
        // 跳过
      }
    }
  } catch {
    return "";
  }

  if (allLines.length === 0) return "";
  const chatLines: string[] = [];

  for (const line of allLines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type !== "message") continue;
      if (!entry.message?.content) continue;

      // 检查时间戳是否在当天
      const ts = entry.timestamp || entry.message?.timestamp;
      if (!ts) continue;
      const entryDate = new Date(ts).toISOString().slice(0, 10);
      if (entryDate !== dateStr) continue;

      const msg = entry.message;
      if (msg.role === "user") {
        const content = typeof msg.content === "string"
          ? msg.content
          : Array.isArray(msg.content)
            ? msg.content.find((c: any) => c.type === "text")?.text || ""
            : "";
        // 清理 QQ 格式
        const cleaned = content.replace(/\[.*?\]\s*/, "").replace(/\(@你\)/, "").trim();
        if (cleaned) chatLines.push(`群友: ${cleaned}`);
      } else if (msg.role === "assistant") {
        const content = Array.isArray(msg.content)
          ? msg.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("")
          : msg.content || "";
        if (content.trim()) chatLines.push(`睦: ${content.trim()}`);
      }
    } catch {
      // skip malformed lines
    }
  }

  return chatLines.join("\n");
}

export async function generateDiary(
  dataDir: string,
  workspaceDir: string,
  llmClient: LLMClient,
  soulPath: string,
): Promise<void> {
  let state: WorldState;
  try {
    state = readWorld(dataDir);
  } catch {
    return; // no world state yet
  }

  const trajectory = state._mutsumi.trajectory;
  if (trajectory.length === 0) return;

  const sessionsDir = path.join(
    path.dirname(workspaceDir),
    "agents", "main", "sessions",
  );

  const chatLog = parseDailyChatLog(sessionsDir, state.date);

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
  fs.writeFileSync(
    path.join(workspaceMemoryDir, `${state.date}.md`),
    diaryContent,
    "utf-8",
  );

  // 插件内部也存一份
  const pluginMemoryDir = path.join(dataDir, "diaries");
  fs.mkdirSync(pluginMemoryDir, { recursive: true });
  fs.writeFileSync(
    path.join(pluginMemoryDir, `${state.date}.md`),
    diaryContent,
    "utf-8",
  );

  // 清空轨迹
  state._mutsumi.trajectory = [];
  const { writeWorld } = await import("./world-state.js");
  writeWorld(dataDir, state);
}
