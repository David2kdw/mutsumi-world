import * as fs from "node:fs";
import * as path from "node:path";
function timestamp() {
    return new Date().toISOString().replace("T", " ").slice(0, 19);
}
function format(level, msg, data) {
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
export function createLogger(dataDir, openclawLogger) {
    const logPath = path.join(dataDir, "mutsumi-world.log");
    function write(level, msg, data) {
        const line = format(level, msg, data);
        // 文件
        try {
            fs.mkdirSync(path.dirname(logPath), { recursive: true });
            fs.appendFileSync(logPath, line + "\n", "utf-8");
        }
        catch { /* 静默失败，不因日志崩溃 */ }
        // OpenClaw logger 也转发一份
        if (openclawLogger) {
            const label = `[mutsumi-world] ${msg}`;
            switch (level) {
                case "ERROR":
                    openclawLogger.error?.(label);
                    break;
                case "WARN":
                    openclawLogger.warn?.(label);
                    break;
                default:
                    openclawLogger.info?.(label);
                    break;
            }
        }
    }
    return {
        debug(msg, data) { write("DEBUG", msg, data); },
        info(msg, data) { write("INFO", msg, data); },
        warn(msg, data) { write("WARN", msg, data); },
        error(msg, data) { write("ERROR", msg, data); },
    };
}
