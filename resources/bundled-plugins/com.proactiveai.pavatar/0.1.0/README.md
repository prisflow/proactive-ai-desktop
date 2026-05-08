# proactive-ai-pavatar-plugin

ProactiveAI Desktop 的 **2D 虚拟形象**插件，与宿主通过标准 `plugin.json` + `main.cjs` 对接。

## 与桌面应用的集成方式

### 源码与构建

本插件逻辑在 **`src/main.ts`**，发布使用 **`npm run build`** 生成 **`dist/main.js`**（ESM）。`plugin.json` 的 `main` 指向 `dist/main.js`；**请将 `dist/` 一并提交或随 Release 上传**，以便 GitHub zip 解压后即可被桌面加载（无需在消费者环境再跑 `tsc`）。

### 1. 从 GitHub 下载（推荐 / CI）

在桌面仓库根目录执行构建前设置：

```bash
set PAVATAR_PLUGIN_GITHUB=你的用户名/proactive-ai-pavatar-plugin
set PAVATAR_PLUGIN_REF=main
npm run build
```

桌面端会用 GitHub `codeload` zip 拉取本仓库并解压到 `out/main/plugins/_builtin/<id>/<version>/`。`PAVATAR_PLUGIN_REF` 可为分支名，或以 `v` 开头的 tag（如 `v0.1.0`）。

可选：仅当未配置本地路径、也未找到同级克隆目录时，使用 **`PAVATAR_PLUGIN_GITHUB_FALLBACK=owner/repo`** 作为默认下载源。

### 2. 本地路径（开发）

将本仓库与桌面应用**同级**放置，或设置 **`PAVATAR_PLUGIN_REPO`** 指向本仓库根目录（含 `plugin.json`）。桌面 `scripts/sync-builtins-plugins.ts` 会复制到 `out/main/plugins/_builtin/`。

### 3. 终端用户：应用内安装

桌面提供 IPC **`plugins:installFromGithub`**（preload：`plugins.installFromGithub`），从 GitHub 安装到 **`userData/plugins/custom/`** 并启用，无需重新打包桌面。

## 权限（manifest）

- `ui.dispatch`：向渲染进程发送 `AVATAR_SET_MOOD` 等消息。
- `pavatar.readActivePack`：通过 `ctx.pavatar.getActivePack()` 读取当前激活 pack 的 `expressions` 等元数据。

## 开发

修改 `main.cjs` 后重新执行桌面端的 `npm run build` 或 `npm run dev`（会先执行 `copy-plugins`）。

调试日志：在桌面启动环境中设置 `PAVATAR_DEBUG=1` 时，本插件会在主进程 `console.log` 部分钩子信息。
