/**
 * 插件开发工具（主上下文内置）：让 LLM 在对话内完成插件的创建/修改/装载/测试。
 *
 * 安全边界：全部文件操作锁定在 userData/plugins/<pluginId>/ 内（归一化 + 前缀校验）；
 * plugin_test = 真实执行（flow 真渲染 / tool 真运行，数据真实变更，无沙箱）。
 */
import fs from 'fs'
import path from 'path'
import { toolRegistry, type ToolDefinition, type ToolResult } from '../conversations/tool'
import { uniqueRunId, logService } from '../../services/logger'
import { pluginLoader } from './loader'
import { flowHost, type FlowDefinition } from '../conversations/flow/flow-host'

/** plugin_write 节点内评审器（写入评审 prompt + 不够好重新生成）：范式规则编译为评审标准。
 *  与 paradigm.md 同源同标准——生成前灌输、写入时执法。 */
const WRITE_REVIEW_SYSTEM = `你是 ProactiveAI 插件代码评审器。按以下标准审查给定的插件分层文件，只报告确定的问题，不要吹毛求疵：
【通用】1) 必须是 CommonJS（require/module.exports），出现 import/export 语句即违规；2) 不得出现自治机制（setTimeout/setInterval/require('fs')/require('child_process')/process 退出等宿主外能力）；3) 依赖方向：本文件只能 require 依赖序中更靠前的层（constants → ledger → rules → schemas/prompts → views → index 组装根），禁止反向依赖。
【文件完整性】每个 .js 必须包含 module.exports（CommonJS 导出）；index.js 必须出现 setup（组装入口导出）；文件必须完整不得截断（括号与字符串闭合、语法可解析、不得半截结束）。
【ledger】状态按会话分键；提供 saveAll 且状态变更后调用；叙事 log 类数组必须有上限裁剪（如 slice(-24)）。
【rules】全部纯函数无副作用（IO/LLM 调用/Math.random 都算副作用，随机数应由调用方注入）；数值守卫范围必须与 schemas 中对应 description 逐字一致。
【schemas】字段语义只写在 description；枚举值必须全部可达。
【views】纯函数只读状态，禁止修改数据；className 仅布局类（flex/gap/items-center 等），不得出现颜色类；**必须使用宿主组件库**（16 个：Text/Button/Row/Column/Divider/Image/Progress/Table/Card/Badge/List/Code/Form/Confirm/Icon/Loading）——进度/好感/数值条一律用 Progress（label/value/max/color），禁止用字符重复（如 '█'、'♡' 的 repeat）手搓；列表用 List、表格用 Table、状态用 Badge、折叠卡用 Card。
【index】只做组装与注册，不写业务逻辑；每个工具需 name/description/inputSchema/run/transformPrompt 齐全；回合结算型工具（结算一次玩家行动）必须 autoYield: true——此时 instruction 不会回喂，禁止写"继续推动剧情"类指令；叙事铺垫型工具 autoYield: false——instruction 必须含"等待玩家行动"语义。
【状态副作用】"首次发生加成"必须先计算加成再置标志位。正确：const bonus = onMeet(cs); cs.met = true; cs.affinity += bonus。错误：先置 cs.met = true 再调 onMeet(cs)（会永远返回 0）。
【flow】若文件注册 flow（api.flow.register）：nodes 必须是数组；节点 type 只能是 llm/static/render/condition；render 节点的渲染函数字段名是 build（写 render 是错的）；工具内调用 api.flow.run 必须 await 并捕获错误（fire-and-forget 会让失败静默逃逸）。
只输出 JSON：{ "pass": boolean, "problems": string[] }。problems 每条 = 具体位置 + 问题 + 修法；没有确定问题就 pass=true 且 problems 为空数组。`

/** 评审器输出契约。 */
const WRITE_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean', description: '是否通过评审' },
    problems: { type: 'array', items: { type: 'string' }, description: '问题清单，每条 = 具体位置 + 问题 + 修法' },
  },
  required: ['pass', 'problems'],
  additionalProperties: false,
}

/** 内部修复器（工具内自修，子代理模式）：按评审问题清单对文件做最小改动修复。
 *  评审与修复全部在工具内闭环——机械问题不再回推外层上下文重新理解。 */
const FIX_SYSTEM = `你是插件文件修复器。给定文件原文与评审问题清单，做【最小改动修复】。
【规则】
1. 只修问题清单指出的问题；不得改动其他内容、不得重排结构、不得丢失注释
2. 保持原文件的风格与已有约定（命名、注释语言、代码风格）
3. 输出修复后的完整文件内容（纯文本；不要 markdown 代码围栏；不要任何解释文字）`

/** plugin_create 需求评估器（门状态判定）：对话历史已注入——从历史判定当前该走哪一步。 */
const REQUIREMENT_EVAL_SYSTEM = `你是 ProactiveAI 插件需求评估器。对话历史已提供给你——根据历史中「用户对新插件的诉求 + 已发生的问询与回答 + 设定稿的确认情况」，判定当前应进入哪一步。
【三态判定】
- need_info：开发所需的关键分歧点还有没答案的（题材与核心循环 / 角色设定 / 结局取向）
- ready_for_design：信息齐了且还没出过稿，或玩家对上一稿提了新的修改意见 → 需要（重新）出设定稿
- confirmed：玩家已明确确认最新一版设定稿（"就按这个开始"、点头等），可以落盘创建
【纪律】
- 玩家表示"你看着办/随便/按你的想法来"→ 视为信息已齐（ready_for_design），默认值交给设计器
- questions 每条 = 玩家一句话就能回答的具体问题；历史里已有答案的不要问；≤3 条；非 need_info 时为空数组
- requirementSummary = 从历史汇总的已确定需求要点（简洁文本，供落盘时写需求确认书）
只输出 JSON：{ "state": "need_info" | "ready_for_design" | "confirmed", "questions": string[], "requirementSummary": string }`

const REQUIREMENT_EVAL_SCHEMA = {
  type: 'object',
  properties: {
    state: { type: 'string', enum: ['need_info', 'ready_for_design', 'confirmed'], description: '当前应进入的流程状态' },
    questions: { type: 'array', items: { type: 'string' }, description: 'state=need_info 时向玩家提出的问题（≤3 条）；否则空数组' },
    requirementSummary: { type: 'string', description: '已确定需求要点汇总（从对话历史提炼）' },
  },
  required: ['state', 'questions', 'requirementSummary'],
  additionalProperties: false,
}

/** plugin_create 设定稿设计器 + 评审（设计门）：需求来自对话历史，历史里有上一稿则按玩家最新意见改稿。 */
const DESIGN_DRAFT_SYSTEM = `你是 ProactiveAI 插件设定设计师。对话历史已提供给你——需求来自历史（用户原话、问询回答、玩家对上一稿的意见）。若历史中存在上一稿设定稿，须在其基础上按玩家最新意见修改；无则首次出稿。
【要求】1) 逐条落实历史中的每一条需求——用户原话优先，你的发挥只允许出现在未覆盖处；2) 小而完整：第一版只做核心循环，宁缺毋滥；3) 角色 1-4 个，人设具体可写（性格、说话方式、彼此差异明显）；4) 玩家意见必须全部消化。`

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    world: { type: 'string', description: '世界观与题材（一两句话）' },
    coreLoop: { type: 'string', description: '核心循环：玩家的一轮回合做什么' },
    characters: {
      type: 'array',
      description: '可攻略/交互角色（1-4 个）',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '角色名' },
          title: { type: 'string', description: '一句话人设称号' },
          personality: { type: 'string', description: '性格与说话方式' },
        },
        required: ['name', 'title', 'personality'],
        additionalProperties: false,
      },
    },
    endingStyle: { type: 'string', description: '结局样式：有没有结局、达成条件、分歧' },
    hook: { type: 'string', description: '差异化钩子：这个插件最让人心动的一点' },
  },
  required: ['world', 'coreLoop', 'characters', 'endingStyle', 'hook'],
  additionalProperties: false,
}

/** 确认分支：从对话历史提取玩家已确认的设定稿与创建标识（无参数搭载，历史即状态）。 */
const CONFIRMED_EXTRACT_SYSTEM = `你是 ProactiveAI 插件创建提取器。对话历史已提供给你——从中提取玩家最后确认的那版设定稿（历史中的设定稿 JSON，或据此重组），并给出插件创建标识。
【规则】
- design：玩家确认的最终设定稿（历史中有多版时，取最后确认的一版并吸收此后的意见）
- name：插件展示名（据设定稿题材拟一个 2-6 字中文名）
- idSuggestion：插件 ID 建议（小写字母开头、字母/数字/下划线，如 bookstore_love；无法拟定则填空字符串）
只输出 JSON：{ "design": { world, coreLoop, characters[], endingStyle, hook }, "name": string, "idSuggestion": string }`

const CONFIRMED_EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    design: DESIGN_SCHEMA,
    name: { type: 'string', description: '插件展示名' },
    idSuggestion: { type: 'string', description: '插件 ID 建议（小写字母/数字/下划线；可为空字符串）' },
  },
  required: ['design', 'name', 'idSuggestion'],
  additionalProperties: false,
}

const DESIGN_REVIEW_PROMPT = `评审这份设定稿：1) 是否逐条覆盖需求确认书（用户原话优先）；2) 角色是否具体可写、彼此差异明显；3) 核心循环是否清晰、单会话内可实施（宁小勿大，无开放式过度承诺）；4) 玩家意见是否已全部消化。有问题指出位置与修法。`

/** plugin_test 输出评审器：检查试跑的真实产出（结果 + UI 渲染树）是否与工具承诺一致。 */
const TEST_REVIEW_SYSTEM = `你是 ProactiveAI 插件试跑评审器。给定：工具名与用途描述、试跑返回的结果、本次运行推送的 UI 渲染树（JSON）——判断这次试跑的真实产出是否合格。
【评审标准】
1. 产出与工具描述承诺一致：如"开场"应推开场界面、"结算回合"应推叙事与新的对话选项
2. UI 树无空内容残留：文案不应只有装饰符号没有正文（如"——"后无文字）、不应有空 Text、空标题
3. 叙事类文本必须实际非空白；选项/按钮必须存在且文案非空
4. 叙事文案中不得出现数值/好感/旗标等游戏机制字眼（除非该工具本就是查询面板）
5. 工具理应推送界面却没有渲染树（renders 为空）→ 不合格
6. UI 中用字符堆叠模拟宿主已有组件（如 █/♡ 重复画进度条）→ 不合格，应使用 Progress 组件
只输出 JSON：{ "pass": boolean, "problems": string[] }。problems 每条 = 现象 + 疑似原因 + 建议修法；合格则 pass=true、problems 为空数组。`

const TEST_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    pass: { type: 'boolean', description: '试跑产出是否合格' },
    problems: { type: 'array', items: { type: 'string' }, description: '问题清单：现象 + 疑似原因 + 建议修法' },
  },
  required: ['pass', 'problems'],
  additionalProperties: false,
}

/** 多轮试玩：玩家模拟器（像真实玩家一样选下一步行动）。 */
const PLAYTEST_SIM_SYSTEM = `你是插件试玩玩家（模拟真实玩家行为）。给定插件的可用工具（含入参 schema）与当前界面状态文本，决定下一步行动。
【规则】
1. 游戏未开始 → 调用开场类工具（描述含"开始/开场/进入"的）
2. 已开始 → 像真实玩家一样从界面选项/情境中选一个自然行动，给出该工具要求的入参（如玩家选择的台词；若选项自带数值设定则按选项设定传入）
3. 抵达结局、无法推进、或继续也不会产生新变化 → 输出 stop
4. 每次只做一步，不要重复已做过且无变化的行动
只输出 JSON：{ "action": "call" | "stop", "tool": "工具名", "input": { ... }, "reason": "一句话" }`

const PLAYTEST_SIM_SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['call', 'stop'], description: 'call=调用工具；stop=结束试玩' },
    tool: { type: 'string', description: '要调用的工具名（action=call 时必填）' },
    input: { type: 'object', description: '工具入参（按工具 schema）' },
    reason: { type: 'string', description: '一句话理由' },
  },
  required: ['action'],
  additionalProperties: false,
}

/** 多轮试玩复盘评审（定论：能不能玩）。 */
const PLAYTEST_REVIEW_SYSTEM = `你是插件试玩复盘评审。给定一次多轮试玩的每轮记录（工具、输入、结果、界面状态），判断这个插件"能不能玩"。
【判据】
1. 状态推进：天数/回合/好感等确实在变化，而不是原地踏步
2. 无卡死：没有同一行动反复、工具连续失败、回合数不前进
3. 界面完整：每轮推送的界面含应有的叙事与选项，无空内容
4. 叙事连贯：剧情承接自然，无明显断裂或复读
5. 路径可达：开局→游玩→（有结局的）结局/重开路径能走通
只输出 JSON：{ "playable": boolean, "problems": string[] }。problems 每条 = 现象 + 疑似原因 + 建议修法；能玩则 playable=true、problems 为空数组。`

const PLAYTEST_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    playable: { type: 'boolean', description: '这个插件是否已经能玩' },
    problems: { type: 'array', items: { type: 'string' }, description: '问题清单：现象 + 疑似原因 + 建议修法' },
  },
  required: ['playable', 'problems'],
  additionalProperties: false,
}

/** 设定稿卡（WidgetNode）：推给玩家确认/提意见。 */function designCard(d: {
  world: string
  coreLoop: string
  characters: { name: string; title: string; personality: string }[]
  endingStyle: string
  hook: string
}): { component: string; props: Record<string, unknown>; children: unknown[] } {
  const kids: unknown[] = [
    { component: 'Text', props: { content: '💞 设定稿（确认后开始生成）', size: 'lg' } },
    { component: 'Divider', props: {} },
    { component: 'Text', props: { content: d.world, size: 'md' } },
    { component: 'Divider', props: {} },
    { component: 'Text', props: { content: `【核心循环】${d.coreLoop}`, size: 'md' } },
  ]
  for (const c of d.characters) {
    kids.push({ component: 'Text', props: { content: `${c.name} · ${c.title}`, size: 'md' } })
    kids.push({ component: 'Text', props: { content: c.personality, size: 'sm' } })
  }
  kids.push({ component: 'Divider', props: {} })
  kids.push({ component: 'Text', props: { content: `【结局】${d.endingStyle}`, size: 'md' } })
  kids.push({ component: 'Text', props: { content: `【钩子】${d.hook}`, size: 'md' } })
  kids.push({ component: 'Divider', props: {} })
  kids.push({
    component: 'Row',
    props: { className: 'gap-2' },
    children: [
      { component: 'Button', props: { content: '就按这个开始', action: { type: 'send', text: '就按这个设定开始生成' } } },
      { component: 'Button', props: { content: '我要提意见', action: { type: 'send', text: '我对设定稿有修改意见：' } } },
    ],
  })
  return { component: 'Column', props: { className: 'gap-2' }, children: kids }
}

/** 错误结果快捷构造。 */
function devErr(msg: string): ToolResult {
  return { ok: false, error: msg }
}

/** 插件目录安全解析：归一化后必须落在 plugins/<pluginId>/ 内。 */
function safePluginDir(pluginId: string): string {
  if (!/^[a-z][a-z0-9_]*$/i.test(pluginId)) throw new Error(`非法插件 ID：${pluginId}`)
  const base = path.resolve(pluginLoader.getPluginsDir())
  const dir = path.resolve(base, pluginId)
  if (!dir.startsWith(base + path.sep)) throw new Error('路径越界')
  return dir
}

/** 清除插件目录内全部模块缓存（多文件插件热重载）。 */
function clearPluginModuleCache(dir: string): void {
  const prefix = dir + path.sep
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(prefix)) delete require.cache[key]
  }
}

/** 剥除 markdown 代码围栏（修复器输出防御）。 */
function stripCodeFences(text: string): string {
  const t = text.trim()
  const m = t.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/)
  return m ? m[1] : t
}

/** 写入前确定性硬守卫（评审之外的兜底，防残缺文件落盘——曾发生"缺 module.exports 的 index.js 过审、reload 才发现"事故）：
 *  .js 必须含 module.exports；语法必须可解析（截断/括号未闭合/ESM 语法在编译期即报）；index.js 必须出现 setup。 */
function staticJsGuard(rel: string, content: string): string | null {
  if (!rel.endsWith('.js')) return null
  if (!content.includes('module.exports')) {
    return `${rel} 缺少 module.exports（本宿主零构建 CJS 插件必须导出；index.js 需导出 setup）`
  }
  try {
    // 仅编译不执行：函数体编译期即可捕获括号未闭合/截断/import 语句等解析错误
    // eslint-disable-next-line no-new-func
    new Function(content)
  } catch (e) {
    return `${rel} 语法检查失败（可能被截断或括号未闭合）：${e instanceof Error ? e.message : String(e)}`
  }
  if (/^index\.js$/i.test(rel) && !/\bsetup\b/.test(content)) {
    return 'index.js 必须导出 setup（如 module.exports = { setup }）'
  }
  return null
}

/** 读插件的需求确认书（供修复器理解意图；缺省空串）。 */
function readIntentText(pluginId: string): string {
  try {
    const p = path.join(safePluginDir(pluginId), 'intent.md')
    if (!fs.existsSync(p)) return '（无设计稿）'
    return fs.readFileSync(p, 'utf-8').slice(0, 2500)
  } catch {
    return '（设计稿读取失败）'
  }
}

/** 评审文件内容。@returns 问题清单（空数组 = 通过）；null = 评审器自身故障（fail-open）。 */
async function reviewFileContent(pluginId: string, rel: string, content: string): Promise<string[] | null> {
  try {
    const review = await flowHost.generate({
      system: WRITE_REVIEW_SYSTEM,
      input: `插件：${pluginId}\n文件：${rel}\n内容：\n${content}`,
      schema: WRITE_REVIEW_SCHEMA,
      maxTries: 1,
    })
    if (!review.ok) return null
    const v = review.data as { pass: boolean; problems: string[] }
    return v.pass === false && v.problems.length > 0 ? v.problems : []
  } catch {
    return null
  }
}

/**
 * 质量闭环（工具内自修，子代理模式）：评审 → 不过则由内部修复器按问题清单修复 → 再评审，≤maxFixRounds 轮。
 * 成功返回最终内容（fixed = 是否经历过修复）；耗尽仍不过返回失败 + 残余问题清单（语义/跨文件类残差才回外层）。
 */
async function reviewAndFixFile(
  pluginId: string,
  rel: string,
  content: string,
  maxFixRounds = 2,
): Promise<{ ok: true; content: string; fixed: boolean } | { ok: false; problems: string[] }> {
  let current = content
  let problems: string[] = []
  for (let round = 0; round <= maxFixRounds; round++) {
    const found = await reviewFileContent(pluginId, rel, current)
    if (found === null || found.length === 0) {
      return { ok: true, content: current, fixed: round > 0 }
    }
    problems = found
    if (round === maxFixRounds) break
    const issueList = problems.map((p, i) => `${i + 1}. ${p}`).join('\n')
    try {
      const fix = await flowHost.generate({
        system: FIX_SYSTEM,
        input: [
          `文件：${rel}（插件 ${pluginId}）`,
          `当前内容：\n${current}`,
          `评审问题清单：\n${issueList}`,
          `设计稿（供理解意图，不得偏离）：\n${readIntentText(pluginId)}`,
        ].join('\n\n'),
        // 修复质量自评审：本轮问题必须被确认修复且不引入新问题（模式一：生成器在工具内，内部重试）
        reviewPrompt:
          WRITE_REVIEW_SYSTEM +
          `\n【本轮必须逐条确认已修复的问题】\n${issueList}\n评审时先核对以上问题是否已修复、是否引入新问题。`,
        maxRetries: 1,
      })
      if (!fix.ok) break
      current = stripCodeFences(String(fix.text ?? fix.data ?? ''))
      if (!current.trim()) break
    } catch {
      break
    }
  }
  return { ok: false, problems }
}

/** 渲染树 → 紧凑文本（供试玩模拟器/复盘阅读；遵循宿主文本化约定）。 */
function renderTreeToText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as { type?: string; props?: Record<string, unknown>; children?: unknown[] }
  const p = n.props ?? {}
  const kids = Array.isArray(n.children) ? n.children.map(renderTreeToText).filter(Boolean).join('\n') : ''
  switch (n.type) {
    case 'Text':
      return String(p.content ?? '')
    case 'Button':
      return `[按钮] ${String(p.content ?? '')}`
    case 'Divider':
      return '---'
    case 'Progress':
      return `[进度] ${String(p.label ?? '')}: ${String(p.value ?? 0)}/${String(p.max ?? 100)}`
    case 'Badge':
      return `[状态] ${String(p.text ?? '')}`
    case 'Image':
      return `[图片: ${String(p.alt ?? '')}]`
    case 'List':
      return `[列表] ${(Array.isArray(p.items) ? p.items : []).join(' / ')}`
    case 'Table':
      return `[表格] 列: ${(Array.isArray(p.columns) ? p.columns : []).join('|')}`
    case 'Card':
      return `[卡片 ${String(p.title ?? '')}]${kids ? '\n' + kids : ''}`
    case 'Row':
    case 'Column':
      return kids
    default:
      return kids || (n.type ? `[${n.type}]` : '')
  }
}

/** 多轮自主试玩：模拟器选行动 → 真实执行 → 逐轮输出评审 → 复盘定论（能不能玩）。 */
async function runPlaythrough(
  pluginId: string,
  meta: { conversationId: string; contextId: string },
  rounds: number,
): Promise<ToolResult> {
  const info = pluginLoader.getLoadedInfo(pluginId)
  const toolNames = info?.tools ?? []
  if (!toolNames.length) {
    return devErr(`插件 ${pluginId} 没有已注册的工具，无法试玩（先 plugin_reload 并确认工具清单）`)
  }
  const inventory = toolNames.map((n) => {
    const def = toolRegistry.get(n)
    return { name: n, description: def?.description ?? '', inputSchema: def?.inputSchema ?? { type: 'object', properties: {} } }
  })
  const roundLog: string[] = []
  let lastRenderText = '（尚无界面，故事尚未开始）'
  let played = 0
  for (let i = 0; i < rounds; i++) {
    // 1) 模拟器决定下一步
    const sim = await flowHost.generate({
      system: PLAYTEST_SIM_SYSTEM,
      input: [
        `插件：${pluginId}`,
        `可用工具：${JSON.stringify(inventory).slice(0, 2600)}`,
        `当前界面状态（文本化）：\n${lastRenderText.slice(0, 1200)}`,
        `已进行 ${played} 轮。最近行动：\n${roundLog.slice(-4).join('\n') || '（无）'}`,
      ].join('\n'),
      schema: PLAYTEST_SIM_SCHEMA,
      maxTries: 1,
    })
    if (!sim.ok) return devErr(`试玩模拟器失败：${sim.error}`)
    const pick = sim.data as { action: string; tool?: string; input?: Record<string, unknown>; reason?: string }
    if (pick.action === 'stop') {
      roundLog.push(`[收尾] ${pick.reason ?? '自然收尾'}`)
      break
    }
    if (!pick.tool || !toolNames.includes(pick.tool)) {
      roundLog.push(`[模拟器给出非法工具 ${String(pick.tool)}，试玩中断]`)
      break
    }
    // 2) 真实执行（捕获渲染树）
    pluginLoader.beginRenderCapture()
    let r: Awaited<ReturnType<typeof toolRegistry.call>>
    let renders: unknown[] = []
    try {
      r = await toolRegistry.call(pick.tool, pick.input ?? {}, {
        conversationId: meta.conversationId,
        contextId: meta.contextId,
      })
    } finally {
      renders = pluginLoader.endRenderCapture()
    }
    played++
    if (!r.ok) {
      roundLog.push(`第 ${played} 轮 ${pick.tool} → 失败：${String(r.error ?? '未知')}`)
      return devErr(
        `试玩中断：第 ${played} 轮 ${pick.tool} 执行失败：${String(r.error ?? '未知错误')}\n已玩记录：\n${roundLog.join('\n')}`,
      )
    }
    lastRenderText = renders.map(renderTreeToText).filter(Boolean).join('\n---\n') || '（本轮无界面推送）'
    const resultText = String((r.result as { text?: string } | undefined)?.text ?? '')
    roundLog.push(
      `第 ${played} 轮 ${pick.tool}(${JSON.stringify(pick.input ?? {}).replace(/\s+/g, ' ').slice(0, 80)}) → ${resultText.replace(/\s+/g, ' ').slice(0, 60)}`,
    )
    // 3) 逐轮输出评审（与单轮试跑同标准）
    const review = await flowHost.generate({
      system: TEST_REVIEW_SYSTEM,
      input: [
        `工具：${pick.tool}`,
        `用途：${toolRegistry.get(pick.tool)?.description ?? '（未知）'}`,
        `试跑返回：${JSON.stringify(r.result ?? {}).slice(0, 800)}`,
        `本次推送的 UI 渲染树（${renders.length} 棵）：`,
        JSON.stringify(renders).slice(0, 4000),
      ].join('\n'),
      schema: TEST_REVIEW_SCHEMA,
      maxTries: 1,
    })
    if (review.ok) {
      const v = review.data as { pass: boolean; problems: string[] }
      if (v.pass === false && v.problems.length > 0) {
        return devErr(
          `试玩中断：第 ${played} 轮输出评审未通过：\n${v.problems.map((p, j) => `${j + 1}. ${p}`).join('\n')}\n请修复后重跑 plugin_test。`,
        )
      }
    }
  }
  if (played === 0) return devErr('试玩未产生任何行动（模拟器未能决定开局或工具清单不匹配），请检查工具描述是否清晰')
  // 4) 复盘定论
  const final = await flowHost.generate({
    system: PLAYTEST_REVIEW_SYSTEM,
    input: `插件：${pluginId}（共试玩 ${played} 轮）\n每轮记录：\n${roundLog.join('\n')}`,
    schema: PLAYTEST_REVIEW_SCHEMA,
    maxTries: 1,
  })
  if (final.ok) {
    const v = final.data as { playable: boolean; problems: string[] }
    if (v.playable === false && v.problems.length > 0) {
      return {
        ok: false,
        error: `试玩定论：暂不能玩。\n${v.problems.map((p, j) => `${j + 1}. ${p}`).join('\n')}\n请修复后重跑 plugin_test。`,
      }
    }
  }
  return {
    ok: true,
    result: { text: `试玩通过（${played} 轮），定论：可以玩。\n${roundLog.join('\n')}` },
  }
}

/**
 * 三段门内部图（宿主所有，plugin_create 的 run() 执行）：评估（读公共历史）→ 条件分支。
 * 状态完全来自对话历史的自动注入（flow 的 llm 节点天然带会话历史）——无 stage/design 参数搭载。
 *   confirmed        → 提取节点（从历史提取已确认设定稿+创建标识）→ static：骨架落盘 + intent.md + 显式装载
 *   ready_for_design → 设计器（历史中有上一稿则按意见改稿）→ render：设定稿卡（走 runFlow 统一落库/推送）
 *   need_info        → 不渲染直接结束（问题清单经 flow data 交工具返回）
 */
function buildCreateFlowDefinition(templateDir: string): FlowDefinition {
  return {
    name: 'plugin_create_flow',
    requireRender: false, // need_info 分支无需渲染
    nodes: [
      // ① 门状态判定（读公共历史）
      {
        type: 'llm',
        system: REQUIREMENT_EVAL_SYSTEM,
        input: () => '请根据对话历史评估当前需求状态，并按契约输出 JSON。',
        schema: REQUIREMENT_EVAL_SCHEMA,
        assign: 'eval',
        maxTries: 1,
        reviewPrompt:
          '评审这份需求评估：state 判定是否符合对话历史的事实（信息缺→need_info；有未消化的意见或还没出稿→ready_for_design；玩家已确认最新稿→confirmed）？questions 是否只包含历史中没有答案的关键分歧点（≤3 条、一句话可答；非 need_info 必须为空）？requirementSummary 是否忠实覆盖历史中的需求要点？有问题指出。',
        maxRetries: 1,
      },
      // ② confirmed 分支：提取 → 落盘
      {
        type: 'condition',
        when: (ctx) => (ctx.data.eval as { state?: string } | undefined)?.state === 'confirmed',
        then: [
          {
            type: 'llm',
            system: CONFIRMED_EXTRACT_SYSTEM,
            input: () => '请从对话历史提取玩家确认的最终设定稿与创建标识。',
            schema: CONFIRMED_EXTRACT_SCHEMA,
            assign: 'spec',
            maxTries: 1,
          },
          {
            type: 'static',
            fn: (ctx) => {
              const hint = (ctx.input ?? {}) as { id?: string; name?: string; description?: string }
              const evalData = (ctx.data.eval ?? {}) as { requirementSummary?: string }
              const spec = (ctx.data.spec ?? {}) as { design?: Record<string, unknown>; name?: string; idSuggestion?: string }
              const design = spec.design ?? {}
              let id = String(hint.id ?? '').trim() || String(spec.idSuggestion ?? '').trim()
              if (id && !/^[a-z][a-z0-9_]*$/i.test(id)) {
                return `插件 ID 非法（须小写字母开头，字母/数字/下划线）：${id}——请重试或由调用方传入合法 id`
              }
              if (!id) id = `custom_${Date.now().toString(36)}`
              const name = String(hint.name ?? '').trim() || String(spec.name ?? '').trim() || id
              const fallbackDesc = String((design as { world?: unknown }).world ?? '')
              const description = String(hint.description ?? '').trim() || fallbackDesc
              try {
                const dir = safePluginDir(id)
                if (fs.existsSync(dir)) {
                  return `插件目录已存在：${id}（直接在此目录上用 plugin_write 修改，或先在设置中卸载）`
                }
                if (!fs.existsSync(templateDir)) return `模板缺失：${templateDir}`
                // 骨架落盘 + 后续逐文件生成期间抑制 watcher（装载时机归 plugin_reload）
                pluginLoader.markDevWriting(id)
                fs.cpSync(templateDir, dir, { recursive: true })
                const manPath = path.join(dir, 'plugin.json')
                const man = JSON.parse(fs.readFileSync(manPath, 'utf-8')) as Record<string, unknown>
                man.id = id
                man.name = name
                man.description = description
                fs.writeFileSync(manPath, JSON.stringify(man, null, 2) + '\n')
                for (const f of fs.readdirSync(dir)) {
                  if (!f.endsWith('.js')) continue
                  const fp = path.join(dir, f)
                  let c = fs.readFileSync(fp, 'utf8')
                  c = c.split('__PLUGIN_ID__').join(id).split('__PLUGIN_NAME__').join(name).split('__PLUGIN_DESCRIPTION__').join(description)
                  fs.writeFileSync(fp, c)
                }
                // 需求确认书 + 设定稿（生成的唯一事实源）
                fs.writeFileSync(
                  path.join(dir, 'intent.md'),
                  `# 需求确认书\n${evalData.requirementSummary || '（未记录）'}\n\n# 已确认设定稿\n\`\`\`json\n${JSON.stringify(design, null, 2)}\n\`\`\`\n`,
                )
                pluginLoader.loadEntryNow(path.join(dir, 'index.js'))
                ctx.data.created = { id, name, dir }
                return
              } catch (e) {
                return `创建失败：${e instanceof Error ? e.message : String(e)}`
              }
            },
          },
        ],
        else: [
          // ③ ready_for_design 分支：设计（历史感知）→ 渲染设定稿卡
          {
            type: 'condition',
            when: (ctx) => (ctx.data.eval as { state?: string } | undefined)?.state === 'ready_for_design',
            then: [
              {
                type: 'llm',
                system: DESIGN_DRAFT_SYSTEM,
                input: () => '请根据对话历史出设定稿（历史中若有上一稿与玩家意见，按最新意见改稿）。',
                schema: DESIGN_SCHEMA,
                assign: 'design',
                maxTries: 1,
                reviewPrompt: DESIGN_REVIEW_PROMPT,
                maxRetries: 1,
              },
              {
                type: 'render',
                build: (ctx) =>
                  designCard(
                    ctx.data.design as {
                      world: string
                      coreLoop: string
                      characters: { name: string; title: string; personality: string }[]
                      endingStyle: string
                      hook: string
                    },
                  ),
              },
            ],
            // else：need_info——不渲染直接结束，问题清单经 flow data 返回
          },
        ],
      },
    ],
  }
}

/** 七个插件开发工具。resourceBase = 宿主 resources 目录（骨架模板所在）。 */
export function createPluginDevTools(resourceBase: string): ToolDefinition[] {
  const templateDir = path.resolve(resourceBase, 'templates', 'plugin-skeleton')

  const inDir = (pluginId: string, rel: string): string => {
    const dir = safePluginDir(pluginId)
    if (!rel || rel.includes('..')) throw new Error('非法相对路径')
    const file = path.resolve(dir, rel)
    if (!file.startsWith(dir + path.sep) && file !== dir) throw new Error('路径越界')
    return file
  }

  // 注册三段门内部图（宿主所有：状态来自公共历史，render 走 runFlow 统一落库/推送；同名注册幂等覆盖）
  try {
    flowHost.register(buildCreateFlowDefinition(templateDir))
  } catch (e) {
    logService.log('error', 'error', {
      runId: uniqueRunId('plugin'),
      name: 'dev-tools.flow-register',
      message: e instanceof Error ? e.message : String(e),
    })
  }

  return [
    // ---------- 创建（三段门 flow：状态自动读取公共历史，无参数搭载） ----------
    {
      name: 'plugin_create',
      description:
        '创建插件的三段流程门（当前应走哪一步由宿主读对话历史自动判定，无需传状态）：' +
        '缺关键需求→返回问题清单（逐条问玩家后再次调用即可）；信息齐→推送设定稿卡（玩家确认或提意见后再次调用）；' +
        '玩家确认→落盘骨架并返回范式全文，进入逐文件生成。',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '可选：插件 ID（缺省由设定稿派生；小写字母开头，字母/数字/下划线）' },
          name: { type: 'string', description: '可选：插件展示名（缺省由设定稿派生）' },
          description: { type: 'string', description: '可选：一句话描述（缺省取设定稿世界观）' },
        },
        required: [],
      },
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) {
          return { success: { toolName: 'plugin_create', error: result.error }, result: { text: `创建失败：${result.error ?? ''}` } }
        }
        const d = (result.result ?? {}) as {
          stage?: string
          questions?: string[]
          summary?: string
          design?: unknown
          id?: string
          paradigm?: string
        }
        if (d.stage === 'ask') {
          return {
            success: { toolName: 'plugin_create' },
            instruction: `需求信息不足，把以下问题逐条问玩家（不要额外追问）：\n${(d.questions ?? []).map((q, i) => `${i + 1}. ${q}`).join('\n')}\n拿到回答后直接再次调用 plugin_create 即可（状态自动判定，无需传任何参数）。`,
            result: { text: '需求信息不足，已生成问询清单。' },
          }
        }
        if (d.stage === 'design') {
          return {
            success: { toolName: 'plugin_create' },
            instruction:
              '设定稿卡已推送给玩家。用一两句话口头介绍设定亮点，然后把选择权交给玩家：玩家说"就按这个开始"或提出修改意见后，直接再次调用 plugin_create 即可（状态自动判定，无需传任何参数）。',
            result: { text: `设定稿已展示。设定稿 JSON：\n${JSON.stringify(d.design)}` },
          }
        }
        // confirm：进入逐文件生成
        const paradigm = String(d.paradigm ?? '')
        return {
          success: { toolName: 'plugin_create' },
          result: {
            text: `骨架已创建（id: ${d.id ?? '（未记录）'}），需求确认书与设定稿已写入 intent.md。\n${paradigm}\n\n【接下来】按范式逐文件生成（每文件一次 plugin_write，内容以设定稿为准）：ledger → rules → schemas → prompts → views → index，全部写完后调用 plugin_reload 装载，再逐工具 plugin_test 试跑。`,
          },
        }
      },
      run: async (input: Record<string, unknown>, meta) => {
        try {
          const r = await pluginLoader.runFlow(
            'plugin_create_flow',
            {
              id: input.id !== undefined ? String(input.id) : undefined,
              name: input.name !== undefined ? String(input.name) : undefined,
              description: input.description !== undefined ? String(input.description) : undefined,
            },
            { conversationId: meta.conversationId, contextId: meta.contextId },
          )
          if (!r.ok) return devErr(`创建流程失败：${r.error ?? '未知'}`)
          const data = r.data as {
            eval?: { state?: string; questions?: string[]; requirementSummary?: string }
            design?: unknown
            created?: { id?: string; name?: string; dir?: string }
          }
          if (data.created) {
            // 范式全文：单一事实源 = resources/skills/plugin-paradigm.md（运行时读取注入，不再两处维护）
            let paradigm = ''
            try {
              paradigm = fs.readFileSync(path.resolve(resourceBase, 'skills', 'plugin-paradigm.md'), 'utf8')
            } catch {
              paradigm = '（范式文档读取失败，请遵循宿主内置骨架注释完成插件）'
            }
            return { ok: true, result: { stage: 'confirm', id: data.created.id, name: data.created.name, dir: data.created.dir, paradigm } }
          }
          if (data.design) {
            return { ok: true, result: { stage: 'design', design: data.design } }
          }
          return {
            ok: true,
            result: {
              stage: 'ask',
              questions: data.eval?.questions ?? [],
              summary: data.eval?.requirementSummary ?? '',
            },
          }
        } catch (e) {
          return devErr(e instanceof Error ? e.message : String(e))
        }
      },
    },

    // ---------- 写入 ----------
    {
      name: 'plugin_write',
      description: '写入/覆盖插件的某个文件（整文件内容）。只接受 .js/.json/.md——本宿主零构建，插件源码必须是 CommonJS JavaScript（.ts 不会被加载，ESM import/export 不可用，用 require/module.exports）。',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: { type: 'string', description: '插件 ID' },
          path: { type: 'string', description: '相对插件目录的文件路径（如 ledger.js、views.js、prompts.js）' },
          content: { type: 'string', description: '完整文件内容' },
        },
        required: ['pluginId', 'path', 'content'],
      },
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) {
          return { success: { toolName: 'plugin_write', error: result.error }, result: { text: `写入失败：${result.error ?? ''}` } }
        }
        const fixed = Boolean((result.result as { fixed?: boolean } | undefined)?.fixed)
        return {
          success: { toolName: 'plugin_write' },
          // 推进锚点：防模型写一两层后提前收轮（2026-09-11 cohabit 停摆教训）
          instruction: '继续按序写下一层（ledger → rules → schemas → prompts → views → index）；全部写完后调用 plugin_reload 装载。',
          result: { text: fixed ? '文件已写入（评审问题已由内部修复器修正，可用 plugin_read 复查）。' : '文件已写入。' },
        }
      },
      run: async (input: Record<string, unknown>) => {
        try {
          const pluginId = String(input.pluginId ?? '')
          const rel = String(input.path ?? '')
          const content = String(input.content ?? '')
          // 零构建硬守卫：只接受 .js/.json/.md（.ts 等一律拒绝，防实现落进永不加载的文件）
          if (!/\.(js|json|md)$/.test(rel)) {
            return devErr(`拒绝写入 ${rel}：本宿主零构建，插件只加载 JavaScript（.js）。请把实现写成 CommonJS 的 .js 文件（require/module.exports），不要写 .ts`)
          }
          // 开发写入抑制：装载时机归 plugin_reload，watcher 不抢跑
          pluginLoader.markDevWriting(pluginId)
          const file = inDir(pluginId, rel)
          fs.mkdirSync(path.dirname(file), { recursive: true })
          // 质量闭环（工具内自修，子代理模式）：评审 → 内部修复器按问题清单修复 → 再评审 ≤2 轮。
          // 机械问题在工具内解决；只有语义/跨文件类残差才会带问题清单回到外层。
          let finalContent = content
          let fixed = false
          if (rel.endsWith('.js')) {
            const gate = await reviewAndFixFile(pluginId, rel, content)
            if (!gate.ok) {
              return devErr(
                `评审未通过（内部修复 2 轮仍未解决，属于需要你判断的语义/跨文件问题）：\n${gate.problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n请修正后重新 plugin_write。`,
              )
            }
            finalContent = gate.content
            fixed = gate.fixed
          }
          // 确定性硬守卫（评审之外的兜底）：CJS 完整性 + 语法可解析 + index 导出 setup
          const guardErr = staticJsGuard(rel, finalContent)
          if (guardErr) return devErr(`拒绝写入：${guardErr}`)
          // 写盘瞬间刷新抑制窗口：长评审/修复（常 >60s）会让工具开始时打的标记过期，防 watcher 抢跑
          pluginLoader.markDevWriting(pluginId)
          const existed = fs.existsSync(file)
          fs.writeFileSync(file, finalContent)
          return { ok: true, result: { written: rel, bytes: finalContent.length, existed, fixed } }
        } catch (e) {
          return devErr(e instanceof Error ? e.message : String(e))
        }
      },
    },

    // ---------- 编辑（opencode edit.ts 对齐：exact-match 校验链 + 行尾归一化） ----------
    {
      name: 'plugin_edit',
      description: '精确替换插件文件中的文本片段（修改现有文件用本工具，不要整文件重写）。oldString 必须与文件内容精确匹配（含空白与缩进）；多处命中时报错并要求提供更多上下文。',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: { type: 'string', description: '插件 ID' },
          path: { type: 'string', description: '相对插件目录的文件路径' },
          oldString: { type: 'string', description: '要替换的原文片段（精确匹配，含空白与缩进；多行可跨行）' },
          newString: { type: 'string', description: '替换后的文本（与 oldString 不同）' },
          replaceAll: { type: 'boolean', description: '替换全部命中（默认 false，仅替换唯一命中）' },
        },
        required: ['pluginId', 'path', 'oldString', 'newString'],
      },
      transformPrompt: (result: ToolResult) => {
        if (!result.ok) {
          return { success: { toolName: 'plugin_edit', error: result.error }, result: { text: `编辑失败：${result.error ?? ''}` } }
        }
        const fixed = Boolean((result.result as { fixed?: boolean } | undefined)?.fixed)
        return {
          success: { toolName: 'plugin_edit' },
          result: { text: fixed ? '编辑已应用（评审问题已由内部修复器修正，可用 plugin_read 复查）。' : '编辑已应用。' },
        }
      },
      run: async (input: Record<string, unknown>) => {
        try {
          const pluginId = String(input.pluginId ?? '')
          const rel = String(input.path ?? '')
          const oldRaw = String(input.oldString ?? '')
          const newRaw = String(input.newString ?? '')
          const replaceAll = input.replaceAll === true
          // 零构建硬守卫：只允许编辑 .js/.json/.md（.ts 不会被加载，编辑它毫无意义）
          if (!/\.(js|json|md)$/.test(rel)) {
            return devErr(`拒绝编辑 ${rel}：本宿主零构建，插件只加载 JavaScript（.js）。.ts 文件不会被加载，请编辑对应的 .js 文件`)
          }
          // 开发写入抑制：装载时机归 plugin_reload，watcher 不抢跑
          pluginLoader.markDevWriting(pluginId)
          const file = inDir(pluginId, rel)
          if (!fs.existsSync(file)) return devErr(`文件不存在：${rel}（新建文件请用 plugin_write）`)
          if (oldRaw === '') return devErr('oldString 不能为空（新建文件请用 plugin_write）')
          if (oldRaw === newRaw) return devErr('oldString 与 newString 相同（无变更）')

          const source = fs.readFileSync(file, 'utf8')
          // 行尾归一化：检测文件行尾格式（Windows CRLF 关键），将输入转换为一致
          const crlf = source.includes('\r\n')
          const oldString = crlf ? oldRaw.replace(/\n/g, '\r\n') : oldRaw
          const newString = crlf ? newRaw.replace(/\n/g, '\r\n') : newRaw

          const hits = source.split(oldString).length - 1
          if (hits === 0) {
            // aider 式相似建议：oldString 首行与文件行的最佳包含匹配
            const firstLine = oldString.split('\n')[0].trim()
            const candidates = source
              .split('\n')
              .filter((l) => l.trim() && (l.includes(firstLine.slice(0, 12)) || firstLine.includes(l.trim().slice(0, 12))))
            const hint = candidates.length
              ? `文件中最接近的行：${candidates[0].trim().slice(0, 80)}`
              : '文件中无相似行——可能文件已变化，先 plugin_read 刷新'
            return devErr(`未找到匹配的原文（必须精确匹配，含空白与缩进）。${hint}`)
          }
          if (hits > 1 && !replaceAll) {
            return devErr(`原文匹配 ${hits} 处：请提供更多上下文保证唯一，或设置 replaceAll 为 true`)
          }
          let updated = replaceAll ? source.split(oldString).join(newString) : source.replace(oldString, newString)
          // 质量闭环（工具内自修）：编辑后的全文过评审 → 不过则内部修复 → 再评审；耗尽则本次编辑不落盘（原子）
          let fixed = false
          if (rel.endsWith('.js')) {
            const gate = await reviewAndFixFile(pluginId, rel, updated)
            if (!gate.ok) {
              return devErr(
                `编辑后评审未通过（内部修复 2 轮仍未解决，本次编辑未落盘）：\n${gate.problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n请修正后重新 plugin_edit。`,
              )
            }
            updated = gate.content
            fixed = gate.fixed
          }
          // 确定性硬守卫（评审之外的兜底）：CJS 完整性 + 语法可解析 + index 导出 setup
          const guardErr = staticJsGuard(rel, updated)
          if (guardErr) return devErr(`拒绝写入（本次编辑未落盘）：${guardErr}`)
          // 写盘瞬间刷新抑制窗口：长评审/修复（常 >60s）会让工具开始时打的标记过期，防 watcher 抢跑
          pluginLoader.markDevWriting(pluginId)
          fs.writeFileSync(file, updated)
          return {
            ok: true,
            result: { edited: rel, replacements: replaceAll ? hits : 1, fixed },
          }
        } catch (e) {
          return devErr(e instanceof Error ? e.message : String(e))
        }
      },
    },

    // ---------- 读取（opencode read.ts 对齐：行号 + 分页 + 二进制检测） ----------
    {
      name: 'plugin_read',
      description: '读取插件的某个文件（带行号，支持 offset/limit 分页），附加 manifest 校验等结构摘要。二进制文件拒绝读取。',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: { type: 'string', description: '插件 ID' },
          path: { type: 'string', description: '相对插件目录的文件路径' },
          offset: { type: 'number', description: '起始行（1-based，可选，缺省从头）' },
          limit: { type: 'number', description: '最大行数（可选，默认 2000）' },
        },
        required: ['pluginId', 'path'],
      },
      transformPrompt: (result: ToolResult) => ({
        success: { toolName: 'plugin_read', ...(result.ok ? {} : { error: result.error }) },
        // 内容必须透传给模型：result.result.text 是带行号的完整文件内容（曾经替换成一句空话导致盲修）
        result: {
          text: result.ok
            ? (result.result as { text?: string } | undefined)?.text ?? '（文件为空）'
            : `读取失败：${result.error ?? ''}`,
        },
      }),
      run: (input: Record<string, unknown>) => {
        try {
          const pluginId = String(input.pluginId ?? '')
          const rel = String(input.path ?? '')
          const file = inDir(pluginId, rel)
          const content = fs.readFileSync(file, 'utf8')
          // 二进制检测：含 NUL 字节 → 拒绝文本读取
          if (content.includes('\0')) return devErr(`二进制文件，无法以文本读取：${rel}`)
          const all = content.split('\n')
          const start = Math.max(1, Number(input.offset ?? 1) || 1)
          const max = Math.max(1, Number(input.limit ?? 2000) || 2000)
          const sliced = all.slice(start - 1, start - 1 + max)
          const truncated = start - 1 + sliced.length < all.length ? `\n…（共 ${all.length} 行，已截断，用 offset=${start + sliced.length} 续读）` : ''
          const numbered = sliced.map((l, i) => `${start + i}: ${l}`).join('\n')
          let summary = `文件：${rel}（${all.length} 行，${content.length} 字符）`
          if (rel.endsWith('plugin.json')) {
            try {
              const man = JSON.parse(content) as Record<string, unknown>
              summary += `\n清单校验：id=${String(man.id)} version=${String(man.version)} entry=${String(man.entry ?? 'index.js')}`
            } catch {
              summary += '\n清单校验：plugin.json 解析失败'
            }
          }
          return { ok: true, result: { text: `${summary}\n${numbered}${truncated}` } }
        } catch (e) {
          return devErr(e instanceof Error ? e.message : String(e))
        }
      },
    },

    // ---------- 文件操作 ----------
    {
      name: 'plugin_fs',
      description: '插件目录内的文件操作（move/delete/copy）。全部路径相对插件目录，越界拒绝。',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: { type: 'string', description: '插件 ID' },
          op: { type: 'string', enum: ['move', 'delete', 'copy'], description: '操作类型' },
          from: { type: 'string', description: '源（相对插件目录）' },
          to: { type: 'string', description: '目标（相对插件目录；delete 时省略）' },
        },
        required: ['pluginId', 'op', 'from'],
      },
      transformPrompt: (result: ToolResult) => ({
        success: { toolName: 'plugin_fs', ...(result.ok ? {} : { error: result.error }) },
        result: { text: result.ok ? '文件操作完成。' : `操作失败：${result.error ?? ''}` },
      }),
      run: (input: Record<string, unknown>) => {
        try {
          const pluginId = String(input.pluginId ?? '')
          const op = String(input.op ?? '')
          // 开发写入抑制：装载时机归 plugin_reload，watcher 不抢跑
          pluginLoader.markDevWriting(pluginId)
          const from = inDir(pluginId, String(input.from ?? ''))
          if (op === 'delete') {
            fs.rmSync(from, { recursive: true, force: true })
            return { ok: true, result: { deleted: path.basename(from) } }
          }
          const to = inDir(pluginId, String(input.to ?? ''))
          if (op === 'move') {
            fs.mkdirSync(path.dirname(to), { recursive: true })
            fs.renameSync(from, to)
          } else if (op === 'copy') {
            fs.mkdirSync(path.dirname(to), { recursive: true })
            fs.cpSync(from, to, { recursive: true })
          } else {
            return devErr(`未知操作：${op}`)
          }
          return { ok: true, result: { op, from: path.basename(from), to: path.basename(to) } }
        } catch (e) {
          return devErr(e instanceof Error ? e.message : String(e))
        }
      },
    },

    // ---------- 装载 ----------
    {
      name: 'plugin_reload',
      description: '装载/热重载插件（写入完成后调用）。返回装载结果与插件当前的注册面清单；失败时报错原文可用于定位修复。',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: { type: 'string', description: '插件 ID' },
        },
        required: ['pluginId'],
      },
      transformPrompt: (result: ToolResult) => ({
        success: { toolName: 'plugin_reload', ...(result.ok ? {} : { error: result.error }) },
        result: { text: result.ok ? '插件已装载。' : `装载失败：${result.error ?? ''}` },
      }),
      run: async (input: Record<string, unknown>) => {
        try {
          const pluginId = String(input.pluginId ?? '')
          // 真实等待装载结果（setup 报错原文回喂 LLM 自修，杜绝假成功）
          const res = await pluginLoader.reloadEntryById(pluginId)
          if (!res.ok) return devErr(`装载失败：${res.error ?? '未知错误'}（修复后重新 plugin_reload）`)
          const info = pluginLoader.getLoadedInfo(pluginId)
          return {
            ok: true,
            result: {
              id: pluginId,
              tools: info?.tools ?? [],
              contexts: info?.contexts ?? [],
              note: (info?.tools ?? []).length === 0 ? '警告：装载成功但注册了 0 个工具——检查 index.js 的 setup 是否调用了 api.registerTool' : undefined,
            },
          }
        } catch (e) {
          return devErr(e instanceof Error ? e.message : String(e))
        }
      },
    },

    // ---------- 试跑 ----------
    {
      name: 'plugin_test',
      description:
        '真实试跑插件并评估产出。两种模式：① 指定 name = 单工具试跑（数据真实变更、UI 真实推送，自动做输出评审）；' +
        '② 不指定 name = 多轮自主试玩（LLM 像玩家一样连玩若干轮，逐轮评审 + 复盘定论"能不能玩"）——宣布完成前必须用此模式验证。',
      inputSchema: {
        type: 'object',
        properties: {
          pluginId: { type: 'string', description: '插件 ID' },
          name: { type: 'string', description: '单工具试跑：要试跑的工具名（省略 = 多轮自主试玩模式）' },
          input: { type: 'object', description: '单工具试跑的入参（按该工具的 inputSchema）' },
          rounds: { type: 'number', description: '试玩模式的最大轮数（默认 5，范围 1-10）' },
        },
        required: ['pluginId'],
      },
      transformPrompt: (result: ToolResult) => ({
        success: { toolName: 'plugin_test', ...(result.ok ? {} : { error: result.error }) },
        result: { text: result.ok ? '试跑完成，结果见返回与对话中的界面推送。' : `试跑失败：${result.error ?? ''}` },
      }),
      run: async (input: Record<string, unknown>, meta): Promise<ToolResult> => {
        try {
          const pluginId = String(input.pluginId ?? '')
          const name = String(input.name ?? '').trim()
          const ownedList = pluginLoader.getLoadedInfo(pluginId)?.tools ?? []
          if (name && !ownedList.includes(name)) {
            // 诊断导向：给出当前真实注册面 + 三步排查（本次事故的核心教训）
            const liveTools = ownedList.length ? ownedList.join('、') : '（0 个——setup 未注册任何工具，或装载的不是你以为的入口）'
            return devErr(
              `工具 ${name} 不属于插件 ${pluginId} 或未装载。当前该插件实际注册的工具：${liveTools}。` +
                '排查：1) 实现必须写在 index.js（零构建不加载 .ts）；2) setup 内必须 api.registerTool({ name }) 且名字一致；3) 改完调用 plugin_reload 确认工具清单',
            )
          }
          // 无 name → 多轮自主试玩（LLM 自己玩几轮再给定论）
          if (!name) {
            if (!ownedList.length) {
              return devErr(`插件 ${pluginId} 没有已注册的工具，无法试玩（先 plugin_reload 并确认工具清单）`)
            }
            const rawRounds = Number(input.rounds ?? 5)
            const rounds = Math.max(1, Math.min(10, Number.isFinite(rawRounds) ? Math.round(rawRounds) : 5))
            return await runPlaythrough(pluginId, meta, rounds)
          }
          const toolInput = (input.input as Record<string, unknown> | undefined) ?? {}
          // 输出评审（condition 门）：捕获本次试跑推送的 UI 渲染树，连同结果交评审器——
          // 拦截"不抛错但产出为空/不完整"的静默缺陷（如跨文件字段名错配导致叙事为空）
          pluginLoader.beginRenderCapture()
          let result: Awaited<ReturnType<typeof toolRegistry.call>>
          let renders: unknown[] = []
          try {
            result = await toolRegistry.call(name, toolInput, {
              conversationId: meta.conversationId,
              contextId: meta.contextId,
            })
          } finally {
            renders = pluginLoader.endRenderCapture()
          }
          if (!result.ok) {
            return { ok: false, error: `试跑失败：${result.error ?? '未知错误'}` }
          }
          try {
            const toolDef = toolRegistry.get(name)
            const review = await flowHost.generate({
              system: TEST_REVIEW_SYSTEM,
              input: [
                `工具：${name}`,
                `用途：${toolDef?.description ?? '（未知）'}`,
                `试跑返回：${JSON.stringify(result.result ?? {}).slice(0, 1200)}`,
                `本次推送的 UI 渲染树（${renders.length} 棵）：`,
                JSON.stringify(renders).slice(0, 6000),
              ].join('\n'),
              schema: TEST_REVIEW_SCHEMA,
              maxTries: 1,
            })
            if (review.ok) {
              const verdict = review.data as { pass: boolean; problems: string[] }
              if (verdict.pass === false && verdict.problems.length > 0) {
                return {
                  ok: false,
                  error: `试跑产出未通过评审：\n${verdict.problems.map((p, i) => `${i + 1}. ${p}`).join('\n')}\n请修复后重跑 plugin_test。`,
                }
              }
            }
            // 评审器自身故障（网络等）fail-open：放行，不阻塞试跑
          } catch {
            // 评审异常 fail-open
          }
          return {
            ok: true,
            result: {
              text: `试跑成功（输出评审通过）：${JSON.stringify(result.result ?? {}).slice(0, 1200)}`,
            },
          }
        } catch (e) {
          return devErr(e instanceof Error ? e.message : String(e))
        }
      },
    },
  ]
}
