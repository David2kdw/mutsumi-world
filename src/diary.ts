import * as fs from "node:fs";
import * as path from "node:path";
import { readWorld, writeWorld } from "./world-state.js";
import type { LLMClient } from "./llm-client.js";
import type { WorldState } from "./types.js";

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

  const systemPrompt = fs.readFileSync(soulPath, "utf-8");
  const userPrompt = `今天结束了。请以若叶睦的口吻写一篇简短日记。

今天你的轨迹：
${trajectory.map(t => `- ${t.time} ${t.note}`).join("\n")}

要求：话少、直白、1-5句。写今天发生了什么、感受如何。不写 AI 话。`;

  const diary = await llmClient.complete(systemPrompt, userPrompt);

  const diaryContent = `# ${state.date} 日记

${diary}

> 日记由睦子米自动撰写。
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
  writeWorld(dataDir, state);
}
