/**
 * @proactive-ai/plugin-types —— 宿主插件 API 类型契约。
 *
 * 本地开发：re-export 宿主源码类型（零漂移，宿主类型演进自动跟随）。
 * 发布 npm：相对路径在包外失效，发布前需用 `tsc --emitDeclarationOnly`
 * 从宿主生成独立 .d.ts 冻结进本文件（届时将 re-export 替换为内联定义）。
 */
export type { Plugin, PluginSetupAPI } from '../src/main/modules/plugin/types'
export type { ToolDefinition, NonSilentToolDef, ToolResult, ToolPromptResult, ToolCallMeta } from '../src/main/modules/conversations/tool/types'
export type { ContextDefinition, ContextRole } from '../src/main/modules/conversations/context/types'
export type { FlowNode, FlowCtx, FlowDefinition, FlowResult } from '../src/main/modules/conversations/flow/flow-host'
export type { LlmMessage, LlmConfig, LlmToolDef, LlmResult, StreamChunk } from '../src/main/modules/llm'
