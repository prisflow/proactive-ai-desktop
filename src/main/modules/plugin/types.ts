import type { ContextDefinition } from '../conversations/context/types'
import type { ToolDefinition } from '../conversations/tool/types'
import type { FlowDefinition, FlowResult } from '../conversations/flow/flow-host'

/**
 * 插件定义。一个插件可以注册零到多个上下文和零到多个工具。
 * 插件文件格式：单个 .js 文件，`export default { id, name, version, setup }`。
 * 本组类型为插件开发者/宿主侧的契约定义（不落库），可选字段语义 = 未填写/有宿主默认行为。
 */
export interface Plugin {
  /** 插件唯一 ID，用作注册前缀 */
  id: string
  /** 人类可读名称 */
  name: string
  /** 语义化版本号 */
  version: string
  /** 描述（可省略）。 */
  description?: string
  /**
   * 安装钩子。PluginLoader 加载文件后调用此方法。
   * 插件在此注册上下文和工具。
   */
  setup(api: PluginSetupAPI): void
}

/**
 * 插件包元数据（plugin.json，zip 包内随 entry 一起分发）。
 * 参考 VSCode/Obsidian/Chrome 扩展清单的常见字段，收敛为最小可用集。
 * 字段校验见 plugins/installer.ts 的 validateManifest。
 * 不落库，可选字段 = 未填写时的宿主默认行为（如 entry 默认 'index.js'）。
 */
export interface PluginManifest {
  /** 插件唯一 ID，必须与 JS 内 plugin.id 一致（校验强约束）。 */
  id: string
  /** 展示名。 */
  name: string
  /** semver 版本号，必须与 JS 内 plugin.version 一致。 */
  version: string
  /** 描述，用于 UI 展示（可省略）。 */
  description?: string
  /** zip 内入口文件名，默认 'index.js'。 */
  entry?: string
  /** 宿主最低版本（大于则拒绝安装；不填不校验）。 */
  minAppVersion?: string
  /** 作者（可省略）。 */
  author?: string
  /** 下载来源（如 COS 地址），展示用（可省略）。 */
  homepage?: string
}

/** 简单 semver 校验：主.次.补丁（允许预发布后缀）。 */
export function isSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+([-.+][0-9A-Za-z.-]+)?$/.test(v)
}

/**
 * 插件安装时获得的 API。
 * 上下文和工具分别注册到各自的全局注册表，互不耦合。
 */
export interface PluginSetupAPI {
  /** 注册一个子上下文到全局 ContextRegistry */
  registerContext(def: ContextDefinition): boolean
  /** 注册一个工具到全局 ToolRegistry */
  registerTool(def: ToolDefinition): boolean
  /** 插件持久化存储（SQLite plugin_data 表，按插件 ID 一行，值可为任意 JSON）。
   * 按对话分键的数据以 conversationId 为顶层键（如 { [cid]: 存档 }），会话删除时会被框架自动清理。 */
  storage: {
    /**
     * 读取插件持久化数据，无记录返回 null。
     */
    get(): unknown
    /** 整体覆盖写入插件持久化数据。 */
    set(data: unknown): void
  }
  /**
   * 头部稳定层注入（三段式 system 稳定前缀）。
   * 向当前会话+上下文的头部注入固定/慢变文本（如世界状态卡），
   * 宿主组装 LLM 请求时自动读入稳定前缀（慢变 → 缓存恒命中）。
   * 落库归属自动取自宿主执行上下文（工具/flow 执行期间），插件无需传会话 ID。
   */
  prompts: {
    /** 注入/更新头部稳定层文本（覆盖该会话+上下文的注入位）。 */
    set(text: string): void
    /** 移除已注入的文本。 */
    remove(text: string): void
  }
  /** 宿主 LLM 能力：结构化生成（schema 校验失败自动重试）。 */
  llm: {
    /**
     * 调用宿主 LLM 生成内容。
     * 提供 schema 时要求输出 JSON 并按 schema 校验，失败自动回喂重试。
     * @param input.system 系统提示
     * @param input.input 用户输入
     * @param input.schema 可选的 JSON Schema（结构化输出）
     * @param input.maxTries 校验失败重试次数（默认 2）
     * @returns 成功返回 { ok:true, text, data }；失败返回 { ok:false, error }
     */
    generate(input: {
      system: string
      input: string
      schema?: Record<string, unknown>
      maxTries?: number
    }): Promise<{ ok: true; text: string; data: unknown } | { ok: false; error: string }>
  }
  /** 回合执行器（图）：工具的 run() 内部实现设施，节点是原工具内容的程序化拆分。 */
  flow: {
    /**
     * 注册一张图（节点链，FlowDefinition）。render 节点放在必经路径上保证渲染必达。
     * @returns 是否注册成功（重名返回 false）
     */
    register(def: FlowDefinition): boolean
    /**
     * 执行一张图。会话归属自动取自宿主执行上下文（工具执行期间），
     * 渲染通过 push 通道推送给前端并落库到当前会话。
     * @param name 图名
     * @param input 工具传入的参数
     * @returns 执行结果（失败时 error 携带原因）
     */
    run(
      name: string,
      input: unknown
    ): Promise<FlowResult>
  }
}
