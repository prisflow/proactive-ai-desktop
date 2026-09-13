/**
 * __PLUGIN_NAME__ —— 插件入口（组装根）。
 *
 * 组装顺序（依赖方向铁律）：ledger（数据）→ rules（规则）→ views（表现）→ 注册。
 * 本文件只做组装与注册，不写业务逻辑。
 */
const { createLedger } = require('./ledger')
const { createRules } = require('./rules')
const { createViews } = require('./views')
const { INITIAL_PROMPT } = require('./prompts')

const plugin = {
  id: '__PLUGIN_ID__',
  name: '__PLUGIN_NAME__',
  version: '0.1.0',
  description: '__PLUGIN_DESCRIPTION__',
  setup(api) {
    const ledger = createLedger(api)
    ledger.load()
    const rules = createRules(ledger)
    const views = createViews(rules)

    // TODO: 需要多步生成/界面推送时，在此注册流（api.registerFlow）——
    // 简单插件可直接用工具的 transformPrompt 回喂 + autoYield 收轮，无需 flow。

    api.registerContext({
      contextId: '__PLUGIN_ID__',
      role: 'sub',
      description: '__PLUGIN_DESCRIPTION__（仅当用户明确要使用本插件时进入，闲聊不要进入）',
      initialPrompt: INITIAL_PROMPT,
      toolNames: [], // TODO: 插件工具名列表（生成后填入）
    })
  },
}

module.exports = plugin
