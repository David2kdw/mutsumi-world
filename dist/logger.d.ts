export interface Logger {
    debug(msg: string, data?: unknown): void;
    info(msg: string, data?: unknown): void;
    warn(msg: string, data?: unknown): void;
    error(msg: string, data?: unknown): void;
}
/**
 * 创建双写日志器：同时输出到文件和控制台。
 * 文件路径：<dataDir>/mutsumi-world.log
 */
export declare function createLogger(dataDir: string, openclawLogger?: {
    info?: (msg: string) => void;
    warn?: (msg: string) => void;
    error?: (msg: string) => void;
}): Logger;
