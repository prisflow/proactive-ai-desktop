---
name: plugin-paradigm
description: ProactiveAI 插件开发范式——九层解剖、数据流、宿主插件 API 全说明与每层编写契约。创建/修改/审查插件前必读。
---

# ProactiveAI 插件开发范式

## 〇、一句话定义

> **插件 = 一个由宿主托管的"领域世界"**：提示词定义世界的行为边界，Schema 定义 LLM 的输出契约，Ledger 定义世界的事实，Rules 定义世界的确定性法则，Tools 定义玩家能做的事，Flows 编排一次完整的回合，Views 把世界呈现给人。

## 一、核心数据流（一切围绕这条主链）

```
用户发言 → 主上下文调度器（按 context.description 决定进入哪个插件世界）
  ↓
[③prompts] 世界的人设与协议约束 LLM 行为
  ↓
LLM 产生意图 → [⑦tools] 触发业务管线（一次调用 = 一回合）
  ↓
管线内 [⑧flows] 编排：LLM 按 [④schemas] 生成
  → [⑥rules] 校验/结算（确定性）
  → [⑤ledger] 落账（状态变更）
  → [⑨views] 渲染成 UI 树 → 宿主推送
  ↓
玩家看到界面与叙事 → 继续发言 → 循环
```

**依赖方向铁律**：`prompts/schemas/constants`（资产层，被引用）→ `ledger → rules → views`（单向）→ `tools/flows` 依赖全部但只经构造注入。**views/rules 永不反向依赖 tools/flows。**

## 插件形态边界（硬约束）

本架构支持的是**回合制对话驱动的领域插件**：一切能力经工具触发、状态经 ledger 维护、表现经 views 推送、回合经 autoYield/调度收束。

**语言硬规则**：插件源码**只能是 CommonJS JavaScript（.js 文件）**——`require` / `module.exports`，宿主零构建，**不加载 .ts、不支持 ESM import/export**（plugin_write 也只接受 .js/.json/.md）。骨架模板即语法样板。

**不支持、生成时不得发明**的形态：

- 全局事件驱动的自治型插件（后台定时器、自主轮询、无用户输入自运转）
- 直接操作宿主进程/文件系统（插件能力面 = setup(api) 注入的接口，无其他）
- 绕过上下文/工具/流注册面私自挂钩宿主内部

生成插件代码时若发现需要以上形态才能实现需求，**停止生成并向用户说明架构边界**，而不是发明宿主不存在的机制。

## 生成流程（plugin_create 三段门）

用户需求通常是不清晰的——**禁止拿到一句话就开始写代码**。plugin_create 是三段门（**当前该走哪一步由宿主读对话历史自动判定，无需传任何状态参数**）：

```
ask 需求问询 → design 设定稿 → confirm 确认生成
```

| 段 | 发生什么 | 你的动作 |
|---|---|---|
| **ask 需求问询** | 评估器从对话历史找关键分歧点（题材循环/角色设定/结局取向）。缺信息 → 返回问题清单（≤3 条） | 逐条问玩家；拿到回答后**直接再次调用 plugin_create 即可**（状态自动判定）。玩家说"你看着办"评估器会自动放行 |
| **design 设定稿** | 设计器按历史中的需求出设定稿，**UI 卡直接推给玩家**（世界观/角色群像/核心循环/结局/钩子）；历史里有上一稿则按玩家意见改稿 | 简介亮点后交出选择权；玩家确认或提意见后**直接再次调用 plugin_create 即可**（无需传状态） |
| **confirm 确认生成** | 宿主从历史提取玩家确认的设定稿，骨架落盘，需求确认书+设定稿写入 intent.md | 此时才开始逐文件生成——**设定稿是生成的唯一事实源**，每个生成器的 system 都要贴合设定稿 |

**从简原则（防能力滥用）**：默认只在 L1 层生成（tools + ledger + rules + schemas + prompts + views + api.llm.generate）。**flows / compaction 属于 L2**——仅当设定稿明确需要多步编排管线或长期剧情压缩时使用，且使用前说明理由。能不用的层一律不用：能力面越小，踩空越少。

**问询纪律**：每轮最多 3 问、只问影响可实施性的分歧点；玩家说"你看着办"即放行并记录默认值；改稿轮次不设硬限（改稿就是需求发现），需求要点由宿主随历史自动汇总。

## 二、九个关注点（层解剖）

| # | 层 | 形态 | 职责 | 层内禁止 |
|---|---|---|---|---|
| ① | **manifest** | plugin.json | 身份/版本/入口/最低宿主版本 | — |
| ② | **setup（index）** | 组装根 | 按依赖序 `ledger→rules→views→flows→tools` 构造并注册；声明 context（人设/工具可见性/压缩配置） | 写业务逻辑 |
| ③ | **prompts** | 字符串资产 | LLM 行为定义：调度器人设与回合协议、每个生成器的系统提示 | 写字段含义（字段的唯一说明源 = schema 的 description） |
| ④ | **schemas** | JSON Schema 常量 | LLM 结构化输出契约——schema 即校验、即文档、即重试依据 | 运行时逻辑 |
| ⑤ | **ledger** | 接口 + 状态类型 | 数据协议：状态类型定义、按会话分键的持久化读写、演进迁移 | 展示逻辑 |
| ⑥ | **rules** | 纯函数集 | 确定性法则：校验（骨架完整性）、结算（数值/状态文本） | 副作用（IO/LLM 调用） |
| ⑦ | **tools** | ToolDefinition[] | 能力入口：LLM 触发状态变化的**唯一动作面**；`autoYield` 声明收轮；transformPrompt 回喂 | 直接推 UI（UI 是管线内 render 节点的必经步骤，不存在"LLM 忘记推 UI"） |
| ⑧ | **flows** | FlowDefinition[] | 多步编排：llm 节点（生成+schema 校验+重试）→ 静态节点（结算）→ render 节点（UI 推送）→ assign（落账） | 内联业务规则（下沉 rules） |
| ⑨ | **views** | 纯函数集（buildScreen 模式） | 表现层：状态 → WidgetNode 树 | 数据修改 |

**横切**：`constants`（领域数值表——"策划数值表"）、`helpers`（纯工具函数）、compaction 配置（长期会话的叙事史摘要）。

## 三、必需 vs 可选（最小可用插件）

| 级别 | 构成 |
|---|---|
| **最小** | manifest + index + context（initialPrompt 纯对话）——零工具零状态 |
| **典型** | + tools（回合管线）+ schemas/prompts（生成器） |
| **完整** | + flows（编排+UI 推送）+ ledger/rules/views（状态世界）+ compaction（长期会话） |

## 四、宿主提供的插件 API（PluginSetupAPI 全说明）

`setup(api)` 的 `api` 参数是宿主注入的全部能力——**生成代码只能使用以下接口，不得假设其他宿主能力**：

### api.registerContext(def) —— 注册子上下文

```js
api.registerContext({
  contextId: 'myplugin',          // 子上下文 ID（全局唯一，建议 = 插件 ID）
  role: 'sub',                    // 固定 'sub'
  description: '……（仅当用户明确要使用本插件时进入，闲聊不要进入）',  // 主上下文调度器的进入判据
  initialPrompt: '……',            // 子上下文人设与协议（每轮头部）
  toolNames: ['my_tool_1'],       // 该上下文内 LLM 可见的工具白名单
  compaction: {                   // 可选：长期会话压缩
    summaryPrompt: '……',          // 摘要器提示
    summarySlot: 'lore',          // 摘要存放槽名
    prefixSlots: ['lore'],        // 稳定前缀槽
    keepTokens: 8000,
    allowResummarize: true,
  },
})
```

### api.registerTool(def) —— 注册工具（LLM 触发状态变化的唯一动作面）

```js
api.registerTool({
  name: 'my_action',                       // 工具名（LLM 调用依据）
  description: '……（给 LLM 看的用途说明，影响它是否/何时调用）',
  inputSchema: { type: 'object', properties: { /* JSON Schema */ }, required: [...] },
  run(input, meta) {                       // meta: { conversationId, contextId, parentRunId? }
    // 业务执行：读写 ledger、调 rules 结算
    return { ok: true, result: { text: '给 LLM 的结果文本' } }
  },
  transformPrompt(result) {                // 结果 → 回喂 LLM 的统一转换
    return {
      success: { toolName: 'my_action' },
      instruction: '下一步建议（随结果回喂 LLM）',
      result: { text: '结果文本' },
    }
  },
  autoYield: true,                         // 可选：执行+渲染后引擎直接收轮
})
```

### autoYield 契约（收轮引擎化——用错必出事，生成前先读）

| 值 | 语义 | instruction 的命运 | 适用工具 |
|---|---|---|---|
| `true` | 工具结算完成后**引擎直接收轮**，话筒交给玩家 | **不会回喂 LLM**（写了也白写） | **回合结算型**：结算一次玩家行动（互动/推进/消费/状态变更） |
| `false`（默认） | 不收轮，GM 拿着 instruction 继续工作 | 正常回喂 | **叙事铺垫型**：登场等需要 GM 续写的场景——instruction 必须含"等待玩家行动后用 xx 工具承接" |

**误用对照**：结算型工具标 `false` 且 instruction 写"继续推动剧情" = GM 自问自答连转（真实事故）；结算型标 `true` 又写"继续推动剧情" instruction = 死代码（不会回喂）。**判定口诀：工具结果已经是玩家要看的最终内容 → `true`；还需要 GM 加工转述 → `false` + "等玩家" instruction。**

### api.storage —— 插件持久化（数据协议核心）

- 存储 = SQLite `plugin_data` 表，**按插件 ID 一行，值为任意 JSON**
- **按会话分键的数据以 conversationId 为顶层键**（如 `{ [cid]: 存档 }`）——会话删除时框架自动清理对应数据
- `api.storage.get()` 读取全部（无记录返回 null）；`api.storage.set(data)` **整体覆盖写入**
- **落账时机**：状态变更后（工具/flow 执行内）调用 set——不留即失

### api.prompts —— 头部稳定层注入（三段式 system 稳定前缀）

- `api.prompts.set(text)`：向当前会话+上下文头部注入固定/慢变文本（如世界状态摘要）——宿主组装请求时自动读入稳定前缀（慢变 → 缓存恒命中）
- `api.prompts.remove(text)`：移除注入

### api.llm.generate(input) —— 宿主 LLM 结构化生成

```js
const res = await api.llm.generate({
  system: '……（生成器系统提示）',
  input: '……（用户输入/素材）',
  schema: MY_SCHEMA,       // 可选 JSON Schema：要求 JSON 输出并按 schema 校验，失败自动回喂重试
  maxTries: 2,             // 校验失败重试次数（默认 2）
  reviewPrompt: '……',      // 可选自我评审提示（评审标准）：输出完成后按此评审，不通过回喂结论重新生成
  maxRetries: 1,           // 评审不通过的最大重新生成次数（默认 1）——质量由引擎保证，不依赖模型自觉
})
// res.ok === true → res.data（按 schema 的对象）+ res.text
// res.ok === false → res.error
```

**reviewPrompt 用法**：把数值合理性（如 delta 是否贴合角色喜好与关系阶段）、叙事质量（是否出戏/是否数值外露）等 schema 管不到的质量标准写成评审提示——引擎自动评审，不通过即带结论重新生成。flow 节点同理支持 `reviewPrompt` / `maxRetries` 属性。

### api.flow —— 流注册与执行

```js
api.flow.register({
  name: 'my_render',              // 图名（同插件内唯一；reload 时随插件自动重注册）
  nodes: [                        // ← 必须是数组；每个节点必须带 type
    // llm 节点：宿主生成（schema 校验失败自动重试；支持自我评审）
    { type: 'llm', system: '……（生成提示）', input: (ctx) => `……（输入素材）`,
      schema: MY_SCHEMA, assign: 'key',      // assign = 产出存入 ctx.data 的键
      maxTries: 2, maxTokens: 4096, reviewPrompt: '……', maxRetries: 1 },
    // static 节点：纯函数校验/记账；返回错误字符串则中止整张图
    { type: 'static', fn: (ctx) => { /* ctx.data / ctx.state 读写 */ } },
    // render 节点：构造 UI 并推送——**渲染函数的字段名是 build**（写 render 是错的）
    { type: 'render', build: (ctx) => ({ component: 'Column', props: { className: 'gap-2' }, children: [] }) },
    // condition 节点：分支
    { type: 'condition', when: (ctx) => bool, then: [ /* 子节点链 */ ], else: [ /* 可选 */ ] },
  ],
  requireRender: true,            // 默认 true：图执行结束后必须已渲染，否则整图失败
})
const result = await api.flow.run('my_render', { /* 入参 */ })   // 必须 await 并捕获错误
// ctx 可用：ctx.input（入参）/ ctx.data（各节点 assign 产物）/ ctx.state / ctx.push / ctx.signal
```

**契约要点**：`nodes` 必须是**数组**；节点 type 只能是 llm/static/render/condition；render 节点的渲染函数字段名是 **build**（写 render 会在注册时被拒）；`api.flow.run` **必须 await 并捕获错误**——fire-and-forget 会让失败变成静默的未处理拒绝，且界面不渲染。结构非法时注册直接抛错（错误原文可用于自修）。没有顶层的 `api.registerFlow`，注册入口只在 `api.flow.register`。

## 五、数据协议（ledger 模式样板）

```js
function createLedger(api) {
  function newState() { return { /* 领域状态字段 */ } }

  const worlds = new Map() // 会话 ID → 状态（内存缓存）

  return {
    get(cid) {                    // 读（或创建）
      if (!worlds.has(cid)) worlds.set(cid, newState())
      return worlds.get(cid)
    },
    saveAll() {                   // 状态变更后调用：整体覆盖持久化
      const data = {}
      for (const [cid, w] of worlds) data[cid] = w
      api.storage.set(data)
    },
    load() {                      // 装载时从存储恢复
      const saved = api.storage.get()
      if (saved && typeof saved === 'object') {
        for (const [cid, w] of Object.entries(saved)) worlds.set(cid, w)
      }
    },
  }
}
```

- 状态变更后**必须 saveAll**（工具/flow 执行内调用）
- 字段变更需考虑旧存档兼容（读取时归一缺省）

## 六、每层编写契约

- prompts 里**永远不写字段含义**——schema 的 description 是字段语义的唯一说明源（改一处全局一致）
- tools 的 run 里**永远不直接推 UI**——管线内 render 节点负责；LLM 只触发管线
- rules 全部纯函数——**同输入必同输出**，可独立单测
- ledger 字段变更必须走版本演进（旧存档读取时归一缺省）
- views **只读状态**——任何"渲染时顺手改数据"都是违规
- tools 的描述面向 LLM 写（这是它被选中/被正确调用的唯一依据）
- UI 只使用宿主调色板契约内的颜色类（见宿主 index.css 的 @source inline 色板）
- **先取后置**：凡"首次发生加成"类逻辑，必须先计算加成再置标志位——
  正确：`const bonus = rules.onMeet(cs); cs.met = true; cs.affinity += bonus`
  错误：先置 `cs.met = true` 再调 `rules.onMeet(cs)`（onMeet 检查 met 会永远返回 0，加成丢失）
- **数组上限**：叙事 log / 事件记录类数组必须设上限裁剪（如 `state.log = state.log.slice(-24)`），防止长期会话存档无限膨胀
- **契约-守卫一致**：rules 中对 LLM 生成值的数值守卫范围，必须与 schemas 里对应 description 声明的范围逐字一致（schema 是语义边界，守卫是它的运行时化身）

## 六点五、WidgetNode 组件库参考（views 层唯一积木）

生成 views 时**只能使用以下 16 个宿主组件**——宿主已有的形制**禁止用 Text 字符手搓**（案例：用 `'█'.repeat()` 手画进度条是违规的，必须用 Progress）。

| 组件 | 关键 props | 用途 |
|---|---|---|
| `Text` | `content`, `size`: 'xs'/'sm'/'md'/'lg', `className` | 一切文字 |
| `Button` | `content`, `action: { type:'send', text }` | 点击 = 以 text 发起一条用户消息 |
| `Row` / `Column` | `className`（布局类：gap-*、items-center、flex-wrap…） | 布局容器 |
| `Divider` | — | 分隔线 |
| `Image` | `src`, `alt`, `width` | 图片 |
| **`Progress`** | `label`, `value`, `max`, `color`: 'default'/'success'/'warning'/'danger' | **一切进度/好感/数值条**（自动渲染 label + 数值 + 条） |
| `Table` | `columns: string[]`, `rows` | 表格数据 |
| `Card` | `title`, `titleAlign`, `collapsible`, `defaultCollapsed`, `children` | 可折叠卡片 |
| `Badge` | `text`, `icon`, `variant`: 'default'/'plain'/'success'/'warning'/'danger', `wrap` | 状态标签 |
| `List` | `items: string[]`, `ordered` | 列表 |
| `Code` | `lang`, `content` | 代码/长文 |
| `Icon` | `name`（lucide 图标名，PascalCase 如 Flame/BookOpen/Target）, `size`, `color` | 图标 |
| `Loading` | `label` | 加载指示 |
| `Form` | `title`, `fields`, `submitLabel`, `action` | 表单 |
| `Confirm` | `title`, `content`, `confirmLabel`, `cancelLabel`, `confirmAction`, `cancelAction` | 确认弹窗 |

**回喂文本化约定**（transformPrompt 把渲染树转述给 LLM 时统一遵循）：`Progress → [进度] {label}: {value}/{max}`；`Table → [表格] 列: a|b|c; 行数: N`；`Badge → [状态] {text}`；`Image → [图片: {alt}]`；`Form → [表单] {title} 字段: …`；其余组件按内容直述。

## 七、生命周期

- **装载**：宿主启动扫描 / 文件变更热重载 / plugin_reload 显式触发
- **压缩**：长期会话按 compaction 配置摘要（叙事史保存在 prefixSlots）
- **卸载**：反注册上下文/工具，数据保留在插件存储

### 压缩的两层职责（不要混淆）

| 层 | 触发 | 提示词来源 | 产物去向 |
|---|---|---|---|
| **上下文内压缩** | 会话历史超过 keepTokens | 插件的 `compaction.summaryPrompt`（registerContext 配置） | host_memory 的 `summarySlot` 槽（如 'lore'），经 `prefixSlots` 回注头部 |
| **子上下文退出总结** | 每次退出子上下文回主上下文 | 插件的 `compaction.summaryPrompt`（配置了就用插件的，未配置用宿主通用移交提示） | 注入主上下文历史（移交报告） |

插件想要"按我的世界口径压缩剧情"，写好 `compaction.summaryPrompt` 即可同时覆盖两层。

## 八、装载后验证清单（生成完成的唯一标准）

每生成完一批文件，**必须**走完此闭环，全部通过才算完成：

1. `plugin_reload` → 确认返回 ok，且**返回的工具清单与你注册的工具一一对应**（清单为空 = index.js 没注册成功）
2. `plugin_test`（指定 name）**逐个试跑你生成的每个工具**——试跑会自动做**输出评审**（检查真实产出：叙事是否为空白、UI 树有无空内容残留、选项是否完整、产出是否与工具承诺一致）；未通过会返回具体问题清单
3. 全部单工具通过后，**不指定 name 再跑一次 `plugin_test` 进入多轮自主试玩**——LLM 会像玩家一样连玩若干轮（开局→连续行动→收尾），逐轮输出评审 + 复盘定论"能不能玩"。**机制类小 bug（状态不推进、卡死重复、后续轮次空叙事、天数/回合不动）只有连玩才会暴露**，这一步通过才叫真完成
4. 有失败时：`plugin_write`/`plugin_edit` 的**质量闭环（评审→内部修复器→再评审）已在工具内自动完成，机械类问题无需你处理**；只有残余的语义/跨文件问题才会带问题清单回到你这里，按清单修正 → 回到第 1 步
5. 全部通过后才向用户宣布完成

**禁止**：跳过验证直接宣布完成；只在 .ts 等不加载的文件上修复问题。

## 九、参考实现

修仙世界插件（proactive-ai-cultivation）是本范式的完整参考实现——三层契约（views/rules/ledger）、提示词资产、schema 契约、flow 编排、工具管线均为生产级示范。

**注意**：内置修仙插件是**平铺单文件**形态（`plugins/cultivation.js` + 同名 json，位于插件根目录）——`plugin_read`/`plugin_edit` 等工具只能访问 `plugins/<插件ID>/` 子目录，**读不到平铺插件**。生成插件时以骨架模板与本范式文档为准，不要尝试读取平铺插件源码。
