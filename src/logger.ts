import * as fs from "node:fs";
import * as path from "node:path";

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface Logger {
  debug(msg: string, data?: unknown): void;
  info(msg: string, data?: unknown): void;
  warn(msg: string, data?: unknown): void;
  error(msg: string, data?: unknown): void;
}

function timestamp(): string {
  const d = new Date();
  // 用本地时间，不用 toISOString（toISOString 返回 UTC，跟世界里的 HH:MM tick 时间对不上）
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function format(level: Level, msg: string, data?: unknown): string {
  const line = `[${timestamp()}] ${level.padEnd(5)} ${msg}`;
  if (data !== undefined) {
    return line + " | " + JSON.stringify(data, null, 2);
  }
  return line;
}

/**
 * 创建双写日志器：同时输出到文件和控制台。
 * 文件路径：<dataDir>/mutsumi-world.log
 */
export function createLogger(
  dataDir: string,
  openclawLogger?: { info?: (msg: string) => void; warn?: (msg: string) => void; error?: (msg: string) => void },
): Logger {
  const logPath = path.join(dataDir, "mutsumi-world.log");

  function write(level: Level, msg: string, data?: unknown): void {
    const line = format(level, msg, data);
    // 文件
    try {
      fs.mkdirSync(path.dirname(logPath), { recursive: true });
      fs.appendFileSync(logPath, line + "\n", "utf-8");
    } catch { /* 静默失败，不因日志崩溃 */ }
    // OpenClaw logger 也转发一份
    if (openclawLogger) {
      const label = `[mutsumi-world] ${msg}`;
      switch (level) {
        case "ERROR": openclawLogger.error?.(label); break;
        case "WARN":  openclawLogger.warn?.(label); break;
        default:      openclawLogger.info?.(label); break;
      }
    }
  }

  return {
    debug(msg, data?) { write("DEBUG", msg, data); },
    info(msg, data?)  { write("INFO", msg, data); },
    warn(msg, data?)  { write("WARN", msg, data); },
    error(msg, data?) { write("ERROR", msg, data); },
  };
}
