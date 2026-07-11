/**
 * OpenClaw 插件预加载入口（CJS 格式）。
 *
 * 框架通过 require() 加载 .cjs 入口，再检查 module.exports 顶层
 * 是否有 register/activate 函数。ESM 的 export default 在 require()
 * 后变成 { default: plugin }，需要展平。
 */
"use strict";
const _pluginModule = require("./dist/index.js");

// 展平 default export：框架检查 register 在 module.exports 顶层
const _default = _pluginModule.default;
const merged = Object.assign({}, _pluginModule);
if (_default && typeof _default === "object") {
  for (const key of Object.keys(_default)) {
    if (!(key in merged)) {
      merged[key] = _default[key];
    }
  }
}

module.exports = merged;
