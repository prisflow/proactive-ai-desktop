# ProactiveAI Desktop

基于 electron-vite + React 的 AI 桌面聊天应用。

## 功能特性

- 🤖 主动对话 - AI 会主动关心你，不只是被动响应
- 🧠 智能记忆 - 记住你的偏好、习惯和重要事项
- 🔒 隐私优先 - 本地存储，数据不经过服务器
- 🎯 分层记忆 - 重要信息自动压缩，高效不丢失关键
- 🎨 现代UI - 基于 React + TailwindCSS 的现代化界面
- 👥 人设模板 - 多种 AI 人设可选
- 🔌 插件扩展（统一 `plugin.json` + CJS/ESM 入口）

## 文档

产品与实现说明见 **`doc/README.md`**（含 v1 规划与「产品现状」系列）。

## 随包插件同步（构建/开发）

构建/开发前会把示例随包插件同步到仓库内的 **`resources/bundled-plugins/<id>/<version>/`**，由 **`scripts/sync-bundled-plugins.ts`** 完成（`npm run build` 与 `npm run dev` 的 `predev` 会执行）。应用首次启动时会把该目录 **seed** 到用户数据 **`userData/plugins/packages/`**，运行时只从后者发现与加载插件（单一路径）。

**默认**：未设置环境变量时，会从默认示例仓库的 **GitHub Release**（当前默认 tag `v0.1.0`，资产名 `com.proactiveai.pavatar-0.1.0.zip`）下载随包插件。若拉取失败会跳过并打印警告。若要拉 **分支源码 zip**（codeload），可设例如 `$env:BUILTIN_PLUGIN_REF='main'`。

```powershell
$env:BUILTIN_PLUGIN_REPO='D:\path\to\plugin-repo'
npm run build
```

**显式指定远端**：

```powershell
$env:BUILTIN_PLUGIN_GITHUB='你的组织/your-plugin-repo'
$env:BUILTIN_PLUGIN_REF='main'
npm run build
```

可选：`BUILTIN_PLUGIN_REF=v0.2.0`（其它 Release tag）、`BUILTIN_PLUGIN_RELEASE_ASSET=my-plugin-0.2.0.zip`（与 tag 对应的 Releases 资产文件名）、`BUILTIN_PLUGIN_GITHUB_DEFAULT` / `BUILTIN_PLUGIN_GITHUB_FALLBACK` 覆盖默认仓库。

插件入口为 **TS 编译的 ESM**（`dist/main.js` + `package.json` 的 `"type":"module"`），宿主用 `import()` 加载。

**应用内安装**：渲染进程可调用 `electronAPI.plugins.installFromGithub('owner/repo', 'main')` 等 API，插件会安装到 **`userData/plugins/packages/`** 并自动启用、重载。

## 环境要求

- Node.js >= 20
- npm >= 10

## 开发

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 打包

```bash
npm run dist:win    # Windows
npm run dist:mac    # macOS
npm run dist:linux  # Linux
```

## Windows 开发环境配置

### 安装 Node.js

推荐使用 [nvm-windows](https://github.com/coreybutler/nvm-windows) 管理 Node.js 版本：

```powershell
# 安装 Node.js 20 LTS
nvm install 20
nvm use 20
```

### 安装 Git

下载 [Git for Windows](https://git-scm.com/download/win)，安装时选择：
- Use Git from Git Bash only
- Checkout Windows-style, commit Unix-style line endings

### 安装 VS Code (推荐)

下载 [VS Code](https://code.visualstudio.com/)，安装后安装推荐扩展：
- ESLint
- Prettier
- Tailwind CSS IntelliSense

### 配置 Git

```bash
git config --global core.autocrlf true
```

### 克隆项目并开发

```powershell
git clone <your-repo-url>
cd proactive-ai-desktop
npm install
npm run dev
```

## 项目结构

```
proactive-ai-desktop/
├── src/
│   ├── main/              # Electron 主进程
│   │   ├── index.ts       # 主进程入口
│   │   ├── chat-core.ts   # 核心聊天功能
│   │   ├── conversation-store.ts
│   │   ├── message-store.ts
│   │   ├── template-store.ts
│   │   └── config-store.ts
│   ├── preload/           # 预加载脚本
│   │   └── index.ts
│   ├── renderer/          # React 渲染进程
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   ├── api.ts
│   │   ├── components/    # UI 组件
│   │   │   ├── ChatArea/
│   │   │   ├── InputArea/
│   │   │   ├── Settings/
│   │   │   └── Sidebar/
│   │   ├── hooks/         # 自定义 Hooks
│   │   ├── stores/         # Zustand 状态管理
│   │   └── utils/          # 工具函数
│   └── shared/            # 共享类型和配置
│       ├── types.ts
│       ├── config.ts
│       ├── constants.ts
│       └── prompt-templates.ts
├── public/                # 静态资源
├── electron.vite.config.ts
├── tailwind.config.js
├── postcss.config.js
└── package.json
```

## 配置

首次使用时需要在设置中配置 OpenAI API Key。

## 许可证

MIT
