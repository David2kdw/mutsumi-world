// preload.cjs — OpenClaw CJS 入口，动态加载 ESM 插件模块
const path = require("node:path");

// 异步加载 dist/index.js (ESM)
module.exports = {
  id: "openclaw-mutsumi-world",
  name: "Mutsumi World",
  description: "若叶睦「楚门的世界」世界模拟插件",

  async register(api) {
    const { default: esmPlugin } = await import(
      path.join(__dirname, "dist", "index.js")
    );
    return esmPlugin.register(api);
  },
};
