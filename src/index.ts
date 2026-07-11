import type { OpenClawPluginApi, PluginRuntime } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { installDataFiles } from "./data-loader.js";
import { startDMScheduler } from "./dm-session.js";
import { registerTools } from "./tools.js";
import { generateDiary } from "./diary.js";
import { createLLMClient } from "./llm-client.js";
import * as path from "node:path";

function getDataDir(runtime: PluginRuntime): string | undefined {
  return (runtime as { getDataDir?: () => string }).getDataDir?.();
}

const plugin = {
  id: "openclaw-mutsumi-world",
  name: "Mutsumi World",
  description: "若叶睦「楚门的世界」世界模拟插件",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    const baseDir = getDataDir(api.runtime) || process.env.HOME || process.env.USERPROFILE || ".";
    const workspaceDir = path.resolve(baseDir, "..", "workspace");
    const dataDir = path.resolve(baseDir, "mutsumi-world");

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
      if (now > diaryTime) diaryTime.setDate(diaryTime.getDate() + 1);
      const delay = diaryTime.getTime() - now.getTime();
      setTimeout(() => {
        const llmClient = createLLMClient(api);
        const soulPath = path.join(workspaceDir, "SOUL.md");
        generateDiary(dataDir, workspaceDir, llmClient, soulPath)
          .then(() => scheduleDiary())
          .catch(err => {
            api.logger?.error?.("[mutsumi-world] Diary generation failed: " + String(err));
            scheduleDiary();
          });
      }, delay);
    }
    scheduleDiary();

    api.logger?.info?.("[mutsumi-world] Plugin registered");
  },
};

export default plugin;
