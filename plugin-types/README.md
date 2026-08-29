# @prisflow/proactiveai-plugin-types

ProactiveAI 宿主插件 API 的类型契约（纯类型，无运行时代码）。

插件开发者通过它获得 `setup(api)` 的全部类型提示与编译检查。

## 安装

```bash
npm i -D @prisflow/proactiveai-plugin-types
```

## 插件入口（单 JS 文件，CJS）

```js
const plugin = {
  id: 'my-plugin',
  name: '我的插件',
  version: '1.0.0',
  setup(api) {
    api.registerContext({ contextId: 'my-ctx', role: 'sub', initialPrompt: '…' })
    api.registerTool({ name: 'my_tool', description: '…', run(input, meta) { return { ok: true, result: input } } })
    api.flow.register({ name: 'my_flow', nodes: [{ type: 'static', fn: () => { } }, …] })
  },
}
module.exports = plugin
```

## 插件包（zip）格式

```
<plugin>.zip
├── plugin.json   # 元数据：id/name/version/entry/minAppVersion（见 PluginManifest）
└── <entry>.js    # 入口（CJS，如上）
```

应用内「设置 → 插件 → 导入插件」选择 zip 即可安装。

## API 速览（PluginSetupAPI）

| 能力 | API |
|---|---|
| 注册上下文 | `api.registerContext(def)` |
| 注册工具 | `api.registerTool(def)` |
| 持久化存储 | `api.storage.get() / api.storage.set(data)` |
| 分层记忆 | `api.memory.set/get/search/remove` |
| LLM 生成 | `api.llm.generate({ system, input, schema })` |
| Flow 图 | `api.flow.register(def) / api.flow.run(name, input)` |
| 提示词注入 | `api.prompts.inject('prefix' | 'suffix', text)` |
| 压缩配置 | `api.compaction.configure(cfg)` |

## 发布（维护者）

`plugin-types/` 是独立 npm 包（`publishConfig.access: public`）。发布前需确认：

1. `index.d.ts` 为**自包含声明**（不 import 宿主相对路径）——当前版本已内联冻结
2. 宿主类型演进时，同步更新 `index.d.ts` 并 bump 版本
3. 发布：`cd plugin-types && npm publish --access pulic`面向外部
