/**
 * 静态规则层：确定性业务规则（校验/结算/格式化）。
 * 全部纯函数——同输入必同输出，禁止副作用（IO/LLM 调用）。
 */
function createRules(ledger) {
  return {
    /** 示例：校验状态完整性（返回错误文本或 null）。 */
    validate(w) {
      // TODO: 领域校验规则
      return null
    },
  }
}

module.exports = { createRules }
