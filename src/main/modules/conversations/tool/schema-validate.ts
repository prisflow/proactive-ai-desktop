/**
 * 工具输入 JSON Schema 校验。
 * 用 ajv 对 ToolDefinition.inputSchema 预编译校验 LLM 传入的参数，
 * 在工具执行前拦截非法输入（防 LLM 参数幻觉导致工具执行异常或历史配对断裂）。
 */
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'

const ajv = new Ajv({ allErrors: true, strict: false })

/**
 * 校验输入是否符合 JSON Schema。
 * @param schema - 工具注册时声明的 JSON Schema
 * @param input - LLM 传入的参数对象
 * @returns 校验通过返回 null，否则返回人类可读的错误描述
 */
export function validateToolInput(schema: Record<string, unknown>, input: unknown): string | null {
  let validate: ValidateFunction
  try {
    validate = ajv.compile(schema)
  } catch (e) {
    // schema 本身非法（插件作者写错）：不拦截，放行由工具自身兜底
    return null
  }
  if (validate(input)) return null
  const errors: ErrorObject[] = validate.errors ?? []
  if (errors.length === 0) return '参数不符合定义'
  return errors.map((e) => `${e.instancePath || 'root'} ${e.message ?? ''}`).join('；')
}
