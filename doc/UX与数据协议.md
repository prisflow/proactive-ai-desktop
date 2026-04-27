# ProactiveAI Desktop - UX 与 Types

## 架构设计

### 数据存储架构

```
渲染进程 (UI)
    ↓ IPC
主进程 (数据层)
    ↓
electron-store → 配置存储（GlobalSettings + PromptTemplates）
lowdb/JSON + 本地 JSON 文件 → 会话/消息存储
```

**存储方案**：

- 配置 → electron-store（GlobalSettings）
- 提示词模板 → electron-store（独立 key）
- 对话列表（含本会话记忆 memory） → lowdb/JSON（`conversations.json`）
- 消息 → 按会话分文件存储（`messages/<conversationId>.json`）

**文件结构**：

```
Electron userData/
├── settings.json            # electron-store：GlobalSettings（config-store.ts）
├── templates.json           # electron-store：PromptTemplate[]（template-store.ts）
└── data/
    ├── conversations.json   # lowdb：Conversation[]（含 memory）
    └── messages/
        ├── conv_*.json      # 每个会话一个消息文件（message-store.ts）
```

> 注：`userData` 路径由 Electron 决定（Windows 通常在 `%APPDATA%/<AppName>` 之类目录），代码中通过 `app.getPath('userData')` 取得。

***

## UX 流程

### 应用启动

```
启动应用 → 加载本地配置 → 检查模板是否存在 → 不存在?注入默认模板 → 加载对话列表 → 显示主界面
```

### 发送消息

```
输入消息 → 点击发送/回车 → 检查API Key → 未配置?提示配置:
    ↓
发送消息 → 从electron-store获取模板rolePrompt → 构建systemPrompt → ChatCore处理 → AI API
    ↓
接收回复 → 转换为ChatMessage → 存储到本地 → 显示消息 → 自动滚动到底部
```

### 切换对话

```
点击对话项 → 加载对应消息 → 更新消息列表 → 清空输入框
```

### 修改全局设置

```
点击设置按钮 → 打开全局设置面板 → 修改全局配置 → 保存到electron-store → 关闭设置面板
```

> 现状：支持主题 **深色 / 浅色 / 跟随系统**（`theme`，`data-theme` + CSS 变量，切换后即时生效；保存写入主进程）。**保存成功**或**验证并保存成功**后会自动关闭设置面板。

### 修改对话配置

```
点击对话配置按钮 → 打开对话配置面板 → 从electron-store加载模板列表 → 选择提示词模板 → 保存templateName到当前对话 → 更新当前对话
```

### 新建对话

```
点击新对话按钮 → 创建新对话 → 清空当前消息 → 清空输入框 → 保存到本地存储
```

### 创建提示词模板

```
点击提示词模板配置 → 打开模板管理面板 → 点击创建模板 → 输入模板名称和角色提示 → 保存到electron-store的templates → 模板列表更新
```

### 删除提示词模板

```
点击提示词模板配置 → 打开模板管理面板 → 点击删除模板 → 确认删除 → 从electron-store的templates移除 → 模板列表更新
```

> 现状：模板 CRUD 的 IPC/API 已实现。渲染层在**设置**中提供默认模板**下拉选择**（自定义模板行**右侧删除图标**）、**「新增模板…」**弹窗创建并选中（内置 `isBuiltIn` 不可删，与主进程一致）；**编辑模板**与独立「模板管理」大面板仍未做。

### 侧边栏交互

```
点击收缩键 → 侧边栏收缩/展开
点击最近对话 → 切换到对应对话
点击全局设置 → 打开全局设置面板
```

> 现状：侧边栏已实现「收缩/展开」「新对话」「最近对话」「对话重命名/删除」「设置」。**对话搜索**、**完整模板管理入口**目前未实现。**社区深链与资源包导入**、**插件运行时与市场**的工程方案见 `doc/社区对接.md`、`doc/插件市场.md`（分里程碑实现，非本文「已实现」范围）。

***

## Types

### GlobalSettings - 全局配置

| 字段                       | 类型                               | 说明           |
| ------------------------ | -------------------------------- | ------------ |
| apiKey                   | string                           | API 密钥       |
| model                    | string                           | 模型名称         |
| baseURL                  | string (可选)                      | API 基础URL    |
| locale                   | "zh-CN" \| "en-US" (可选)          | 界面与下发系统提示语言，默认 zh-CN |
| defaultTemplateName      | string (可选)                      | 默认模板引用（内置为 `builtin_*`，见 template-migration） |
| defaultMaxTriggers       | number (可选)                      | 默认最大触发点数量    |
| defaultProactiveInterval | number (可选)                      | 默认主动对话间隔（秒）  |
| proactiveEnabled         | boolean (可选)                     | 全局默认是否启用主动对话 |
| theme                    | "light" \| "dark" \| "auto" (可选) | 主题           |
| fontSize                 | number (可选)                      | 字体大小         |

### ConversationSettings - 对话级配置

| 字段                  | 类型           | 说明             |
| ------------------- | ------------ | -------------- |
| templateName        | string (可选)  | 提示词模板名（覆盖全局）   |
| proactiveInterval   | number (可选)  | 主动对话间隔（覆盖全局）   |
| recentMessagesCount | number (可选)  | 历史消息数量         |
| proactiveEnabled    | boolean (可选) | 是否启用主动对话（覆盖全局） |
| maxTriggers         | number (可选)  | 最大触发点数量        |

### PromptTemplate - 提示词模板

| 字段         | 类型      | 说明        |
| ---------- | ------- | --------- |
| id         | string  | 模板唯一标识    |
| name       | string  | 模板名称      |
| rolePrompt | string  | 角色提示词     |
| isBuiltIn  | boolean | 是否为系统默认模板 |
| createdAt  | number  | 创建时间戳     |
| updatedAt  | number  | 更新时间戳     |

### Conversation - 对话

| 字段        | 类型                        | 说明     |
| --------- | ------------------------- | ------ |
| id        | string                    | 对话唯一标识 |
| title     | string                    | 对话标题   |
| createdAt | number                    | 创建时间戳  |
| updatedAt | number                    | 更新时间戳  |
| settings  | ConversationSettings (可选) | 对话级配置  |
| memory    | string[] (可选)             | 本会话记忆（由 AI 提取并合并） |

### ChatMessage - 聊天消息

| 字段          | 类型                    | 说明      |
| ----------- | --------------------- | ------- |
| id          | string                | 消息唯一标识  |
| role        | "user" \| "assistant" | 消息角色    |
| content     | string                | 消息内容    |
| createdAt   | number                | 创建时间戳   |
| isProactive | boolean (可选)          | 是否为主动消息 |

### AIResponse - AI 响应（临时）

| 字段                       | 类型                                        | 说明        |
| ------------------------ | ----------------------------------------- | --------- |
| reply                    | string                                    | AI 回复内容   |
| triggers                 | Array<{seconds: number; message: string}> | 触发点列表     |
| next\_api\_call\_seconds | number                                    | 下次调用API时间 |
| important\_info          | string\[]                                 | 提取的重要信息   |

### Trigger - 触发点

| 字段      | 类型     | 说明      |
| ------- | ------ | ------- |
| seconds | number | 触发时间（秒） |
| message | string | 触发消息内容  |

### PluginHooks - 插件钩子

| 字段               | 类型                                                            | 说明      |
| ---------------- | ------------------------------------------------------------- | ------- |
| onMessageSend    | (message: string) => string \| Promise\<string> (可选)          | 消息发送前钩子 |
| onSystemPromptBuild | (input: { systemPrompt, locale?, conversationId? }) => string \| void \| Promise\<…> (可选) | 构造发给模型的 system prompt 时追加片段（如像素小人协议） |
| onMessageReceive | (reply: string) => string \| Promise\<string> (可选)            | 消息接收后钩子 |
| onTrigger        | (trigger: Trigger) => void \| Promise\<void> (可选)             | 触发点钩子   |
| onMemoryUpdate   | (importantInfo: string\[]) => void \| Promise\<void> (可选)     | 记忆更新钩子  |
| onConfigChange   | (config: Record\<string, any>) => void \| Promise\<void> (可选) | 配置变更钩子  |
| onInit           | () => void \| Promise\<void> (可选)                             | 初始化钩子   |
| onDestroy        | () => void \| Promise\<void> (可选)                             | 销毁钩子    |

### Plugin - 插件

| 字段          | 类型                        | 说明   |
| ----------- | ------------------------- | ---- |
| name        | string                    | 插件名称 |
| version     | string                    | 插件版本 |
| description | string (可选)               | 插件描述 |
| author      | string (可选)               | 插件作者 |
| hooks       | PluginHooks               | 插件钩子 |
| config      | Record\<string, any> (可选) | 插件配置 |

> **实现状态**：`Plugin` / `PluginHooks` 在 `shared/types` 中为协议定义；**主进程已加载内置 `PluginRegistry`**，IPC **`plugins:list`** / **`plugins:setEnabled`** 与设置页插件区 **已接**。当前内置插件 **仅 `com.proactiveai.pavatar`**（详见 **`doc/插件市场.md`**、**`doc/像素小人插件.md`**）。远程市场 / 动态 `.paplugin` **未做**。

***

## 实现进度与文档差异（当前代码）

| 类别 | 文档或设想 | 当前实现 |
| --- | --- | --- |
| 窗口与菜单 | （旧版曾描述菜单栏顺序） | **无系统菜单**；**无边框**；顶栏 `WindowChrome` 居中 **ProactiveAI**，Windows/Linux **右侧窗控**；IPC：`window:minimize` / `window:maximize-toggle` / `window:close`；preload 暴露 `platform` |
| 主题 | `GlobalSettings.theme` | **已接 UI**：浅色/深色/跟随系统，`html[data-theme]` + CSS 变量 |
| 设置 | 全局配置面板 | API Key、模型、Base URL、模板下拉、**新增模板**弹窗、主动间隔/最大触发数/开关、**本会话记忆**查看与清空；保存或验证成功**自动关面板** |
| 对话级配置 | `ConversationSettings` 面板 | **类型与主进程 send 逻辑支持**部分字段；**无独立「每会话设置」UI**（如按会话选模板） |
| 模板 | 完整模板管理面板 | **下拉（自定义行右侧删）+ 新增**；**无**编辑 UI / 独立大面板 |
| 侧边栏 | 搜索、插件入口 | **未做**；核心导航与对话操作已齐 |
| 插件生态 | `Plugin` / `PluginHooks` + 内置插件 | **已接**：主进程 `PluginRegistry`、`chat:send` 钩子链、IPC `plugins:*`、设置页插件区；详见 **`doc/插件市场.md`**（远程市场 / `.paplugin` 未做） |
| 社区对接 | Web 社区与桌面联动 | **未实现**；方案见 **`doc/社区对接.md`**（深链、`.pabundle`、可选 OAuth） |
| 其它配置 | `fontSize` | 配置项存在，**未绑定界面字号** |

### 消息与滚动（实现细节，原 UX 流程未写清）

- 渲染层对消息列表的**主进程拉取**主要在**切换会话**时触发，并避免用落后快照覆盖本地乐观更新。
- 聊天区**仅在接近底部时**自动滚到底，便于向上翻阅历史。

***

## 数据流

### 消息发送流程

```
用户输入 → 渲染进程 → IPC:sendMessage → 主进程
    ↓
获取templateName → 从electron-store查询PromptTemplate → 获取rolePrompt
    ↓
调用buildSystemPrompt(rolePrompt, maxTriggers) → 生成完整systemPrompt
    ↓
ChatCore → AI API → AIResponse
    ↓
IPC:响应 → 渲染进程 → 显示消息
```

补充：
- AI 返回的 `important_info` 会在主进程合并写入 `Conversation.memory`（会话级记忆），渲染层设置面板可查看/清空。
- `chat:send` 内在调用模型**之前**即将当前用户消息写入 `messageStore`，避免与渲染层乐观更新冲突。
- 模型返回需为 JSON；解析失败时主进程会降级为纯文本 `reply`，避免整次请求崩溃。`choices` 为空时亦有兜底。
- **触发点（triggers）**：到时间后仅在界面追加一条 **assistant** 预设文案，**不再**把该文案当用户输入再次调用 `chat:send`（避免自激循环）。

### 模板选择流程

```
渲染进程 → IPC:templates:list → 主进程 → 从electron-store读取模板列表
    ↓
用户选择模板 → 保存templateName到ConversationSettings
```

### 配置优先级

```
对话级配置 → ConversationSettings.templateName
    ↓ 不存在?
全局配置 → GlobalSettings.defaultTemplateName
    ↓ 不存在?
默认值 → `builtin_default`（系统内置模板，见 `template-migration`）
```

### 模板初始化

```
应用首次启动 → 检查electron-store的templates是否存在 → 不存在?注入系统默认模板列表
```

