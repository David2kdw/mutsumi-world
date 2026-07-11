import * as fs from "node:fs";
import * as path from "node:path";
import type { DMSessionMessage } from "./llm-client.js";

function localTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/**
 * DM session 历史存档格式。
 * 与 world.json 放在同一 dataDir 下，按日期分文件。
 */
export interface DMSessionArchive {
  date: string;                        // "YYYY-MM-DD"
  saved_at: string;                    // ISO timestamp of last save
  history: DMSessionMessage[];         // full chat history (system + user + assistant)
}

const SESSION_PREFIX = "dm-session-";
const SESSION_TMP_PREFIX = ".dm-session-";

function sessionPath(dataDir: string, date: string): string {
  return path.join(dataDir, `${SESSION_PREFIX}${date}.json`);
}

function sessionTmpPath(dataDir: string, date: string): string {
  return path.join(dataDir, `${SESSION_TMP_PREFIX}${date}.json.tmp`);
}

/**
 * 保存 DM session 完整历史到文件（原子写入：.tmp → rename）。
 * 同一天多次保存只会覆盖同一个文件。
 */
export function saveDMSession(
  dataDir: string,
  date: string,
  history: DMSessionMessage[],
): void {
  const tmpPath = sessionTmpPath(dataDir, date);
  const destPath = sessionPath(dataDir, date);

  const archive: DMSessionArchive = {
    date,
    saved_at: localTimestamp(),
    history,
  };

  const json = JSON.stringify(archive, null, 2);
  fs.writeFileSync(tmpPath, json, "utf-8");
  fs.renameSync(tmpPath, destPath);
}

/**
 * 加载指定日期的 DM session 历史。不存在则返回 null。
 */
export function loadDMSession(
  dataDir: string,
  date: string,
): DMSessionArchive | null {
  const destPath = sessionPath(dataDir, date);
  try {
    const raw = fs.readFileSync(destPath, "utf-8");
    return JSON.parse(raw) as DMSessionArchive;
  } catch {
    return null;
  }
}

/**
 * 删除指定日期的 DM session 存档。
 */
export function deleteDMSession(dataDir: string, date: string): void {
  const destPath = sessionPath(dataDir, date);
  try {
    fs.unlinkSync(destPath);
  } catch {
    // 文件不存在，无需操作
  }
}

/**
 * 列出所有已保存的 session 日期。
 */
export function listDMSessions(dataDir: string): string[] {
  const dates: string[] = [];
  try {
    const entries = fs.readdirSync(dataDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = entry.name.match(/^dm-session-(\d{4}-\d{2}-\d{2})\.json$/);
      if (match) dates.push(match[1]);
    }
  } catch {
    // 目录不存在或无法读取
  }
  return dates.sort();
}
