import * as fs from "node:fs";
import * as path from "node:path";
import { readWorld } from "./world-state.js";
import type { LLMClient } from "./llm-client.js";

function localTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function getDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** 日记文件路径 */
function diaryPath(baseDir: string, date?: string): string {
  const d = date || getDate();
  return path.join(baseDir, `${d}.md`);
}

/** 初始化日记文件——如果不存在则创建标题 */
function initDiaryFile(dir: string, date?: string): string {
  ensureDir(dir);
  const filePath = diaryPath(dir, date);
  const d = date || getDate();
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, `# ${d} 日记\n\n`, "utf-8");
  }
  return filePath;
}

/**
 * 追加一条手动日记。
 * bot 想到什么写什么，直接 append，不经 LLM。
 */
export function appendDiaryEntry(
  dataDir: string,
  workspaceDir: string,
  text: string,
): void {
  const time = localTimestamp();
  const entry = `## ${time}\n${text}\n\n`;
  const date = getDate();

  // 双写：workspace/memory + repo/diaries
  const dirs = [
    path.join(workspaceDir, "memory"),
    path.join(dataDir, "diaries"),
  ];

  for (const dir of dirs) {
    initDiaryFile(dir, date);
    fs.appendFileSync(diaryPath(dir, date), entry, "utf-8");
  }
}

/**
 * 23:30 自动总结。
 * 读取今天手动写的日记条目 + 轨迹，用 LLM 生成简短总结，
 * 追加到日记末尾。
 */
export async function generateDiary(
  dataDir: string,
  workspaceDir: string,
  llmClient: LLMClient,
  soulPath: string,
): Promise<void> {
  const date = getDate();

  // 读取今天的手动日记条目
  const dirs = [
    path.join(workspaceDir, "memory"),
    path.join(dataDir, "diaries"),
  ];

  let manualEntries = "";
  for (const dir of dirs) {
    try {
      const filePath = diaryPath(dir, date);
      if (fs.existsSync(filePath)) {
        manualEntries = fs.readFileSync(filePath, "utf-8");
        break;
      }
    } catch { /* skip */ }
  }

  // 读取轨迹
  let trajectory = "";
  try {
    const state = readWorld(dataDir);
    trajectory = state._mutsumi.trajectory
      .map(t => `- ${t.time} ${t.note}`)
      .join("\n");
  } catch { /* no world state yet */ }

  if (!manualEntries && !trajectory) return;
  if (!manualEntries && !trajectory.trim()) return;

  const systemPrompt = fs.readFileSync(soulPath, "utf-8");
  const userPrompt = `今天结束了。请以若叶睦的口吻写一篇简短的睡前回顾。

${manualEntries ? `今天随手记的日记：\n${manualEntries}` : ""}
${trajectory ? `今天的轨迹：\n${trajectory}` : ""}

要求：话少、直白、2-4句。总结今天最重要的一两件事和当下的感受。不写 AI 话。`;

  const summary = await llmClient.complete(systemPrompt, userPrompt);

  const entry = `---\n\n> 睡前回顾\n\n${summary}\n\n> 日记由睦子米自动撰写。\n`;

  // 追加到两个目录
  for (const dir of dirs) {
    initDiaryFile(dir, date);
    fs.appendFileSync(diaryPath(dir, date), entry, "utf-8");
  }
}
