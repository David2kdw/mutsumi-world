import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { fileURLToPath } from "node:url";
import { installDataFiles } from "./data-loader.js";
import { startDMScheduler } from "./dm-session.js";
import { registerTools } from "./tools.js";
import { generateDiary } from "./diary.js";
import { createLLMClient } from "./llm-client.js";
import { createLogger } from "./logger.js";
import * as path from "node:path";
function getDataDir(runtime) {
    return runtime.getDataDir?.();
}
// 插件自身根目录（编译后在 dist/，回退一级到仓库根目录）
const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = {
    id: "openclaw-mutsumi-world",
    name: "Mutsumi World",
    description: "若叶睦「楚门的世界」世界模拟插件",
    configSchema: emptyPluginConfigSchema(),
    register(api) {
        const baseDir = getDataDir(api.runtime) || process.env.HOME || process.env.USERPROFILE || ".";
        // OpenClaw workspace 固定路径：~/.openclaw/workspace（仅日记 memory 输出用）
        const workspaceDir = path.join(baseDir, ".openclaw", "workspace");
        // world.json、日志、diaries 存档均放在插件自身目录
        const dataDir = pluginDir;
        const log = createLogger(dataDir, api.logger);
        log.info("Plugin registering", { dataDir, workspaceDir });
        // 首次安装：复制数据文件
        installDataFiles(workspaceDir);
        // 启动调度器
        const scheduler = startDMScheduler(api, dataDir);
        // 注册工具
        registerTools(api, scheduler, dataDir);
        // 23:30 日记定时器
        function scheduleDiary() {
            const now = new Date();
            const diaryTime = new Date(now);
            diaryTime.setHours(23, 30, 0, 0);
            if (now > diaryTime)
                diaryTime.setDate(diaryTime.getDate() + 1);
            const delay = diaryTime.getTime() - now.getTime();
            setTimeout(() => {
                const llmClient = createLLMClient();
                const soulPath = path.join(workspaceDir, "SOUL.md");
                generateDiary(dataDir, workspaceDir, llmClient, soulPath)
                    .then(() => scheduleDiary())
                    .catch(err => {
                    log.error("Diary generation failed: " + String(err));
                    scheduleDiary();
                });
            }, delay);
        }
        scheduleDiary();
        log.info("Plugin registered successfully");
    },
};
export default plugin;
