/**
 * 聊天图片附件服务：粘贴/导入的图片落盘、读取与展示 URL。
 *
 * 存储：userData/attachments/<conversationId>/<uuid>.<ext>
 * 展示：注册 app-attachment:// 协议由 main 的 protocol.handle 直读文件（renderer <img src>）
 * LLM：请求组装时读回 dataURL 作为 image_url 分片（messages as any 直通 OpenAI 兼容 API）
 */
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { logService, uniqueRunId } from '../../services/logger'

/** 附件元数据（落库到消息 extraData，随消息持久化）。 */
export interface SavedAttachment {
  /** 存储文件名（相对 <conversationId>/ 目录） */
  file: string
  mime: string
  name: string
}

/** MIME 白名单（与前端 accept 对齐）。 */
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

/** 单图大小上限（8MB）。 */
const MAX_BYTES = 8 * 1024 * 1024

/** 会话 ID 作为目录名的安全校验。 */
function safeCid(cid: string): boolean {
  return /^[a-z0-9-]{1,64}$/i.test(cid)
}

/** 附件文件名的安全校验（无路径分隔/穿越）。 */
function safeFile(file: string): boolean {
  return !!file && !file.includes('/') && !file.includes('\\') && file !== '.' && file !== '..'
}

/** 某会话的附件目录。 */
function attachmentsDir(cid: string): string {
  return path.join(app.getPath('userData'), 'attachments', cid)
}

/** 附件绝对路径（非法返回 null）。 */
export function attachmentFilePath(cid: string, file: string): string | null {
  if (!safeCid(cid) || !safeFile(file)) return null
  const dir = attachmentsDir(cid)
  const abs = path.join(dir, file)
  if (!abs.startsWith(dir + path.sep)) return null
  return abs
}

/**
 * 保存一张 dataURL 图片到会话附件目录。
 * @returns 元数据；格式不支持/超限/写入失败返回 null（静默跳过，日志留痕）
 */
export function saveAttachment(cid: string, dataUrl: string, name: string): SavedAttachment | null {
  try {
    const m = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl.trim())
    if (!m) return null
    const mime = m[1] // 例如 image/png
    const buf = Buffer.from(m[2], 'base64') // base64数据
    if (!buf.length || buf.length > MAX_BYTES) {
      logService.log('warn', undefined, {
        runId: uniqueRunId('attach'),
        name: 'attachment.reject',
        message: `size ${buf.length} bytes out of range (mime=${mime})`,
      })
      return null
    }
    const ext = MIME_EXT[mime]
    const file = `${randomUUID()}.${ext}`
    const dir = attachmentsDir(cid)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, file), buf)
    return { file, mime, name: name || `image.${ext}` }
  } catch (e) {
    logService.log('warn', undefined, {
      runId: uniqueRunId('attach'),
      name: 'attachment.save-failed',
      message: e instanceof Error ? e.message : String(e),
    })
    return null
  }
}

/** 读回附件 dataURL（供 LLM 请求组装）。不存在返回 null。 */
export function readAttachmentDataUrl(cid: string, file: string): string | null {
  try {
    const abs = attachmentFilePath(cid, file)
    if (!abs || !fs.existsSync(abs)) return null
    const ext = path.extname(abs).slice(1).toLowerCase()
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
    return `data:${mime};base64,${fs.readFileSync(abs).toString('base64')}`
  } catch {
    return null
  }
}

/** 附件的前端展示 URL（由 main 的 app-attachment:// 协议直读文件）。 */
export function attachmentDisplayUrl(cid: string, file: string): string {
  return `app-attachment://${cid}/${encodeURIComponent(file)}`
}
