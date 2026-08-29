import fs from 'fs/promises'
import path from 'path'

/** NDJSON 日志文件最大 10MB，超出后轮转 */
const MAX_FILE_BYTES = 10 * 1024 * 1024
/** 最多保留 5 个轮转历史文件（.0 ~ .4），加上当前文件共 6 个 */
const MAX_FILES = 5
/** 每 5 分钟检查一次文件大小是否需要轮转 */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000

/**
 * 轮转文件写入器。串行写入 app.trace.log，超过 10MB 时自动轮转。
 * 轮转序列：app.trace.log → app.trace.log.0 → .1 → .2 → 删除最老的。
 */
export class RotatingFileWriter {
  /**
   * 串行化写入链（手动 Promise 队列）。
   * append() 是同步调用、异步落盘；若不排队，多次 fs.appendFile
   * 会并发执行，行序可能交错错乱。这里把每次写入挂到上一次写入的
   * Promise 后面，保证严格 FIFO：前一行写完才写下一行。
   * 链尾的 catch(() => {}) 防止某次写入失败导致整条链中断，
   * 写入错误静默忽略 —— 日志失败绝不能影响主流程。
   */
  private writeChain: Promise<void> = Promise.resolve()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(private filePath: string) {
    this.startCleanupTimer()
  }

  /** 追加一行 NDJSON 到文件。串行执行，写入失败静默忽略。 */
  append(line: string): void {
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.appendFile(this.filePath, line + '\n', 'utf-8')
    }).catch(() => {})
  }

  /**
   * 读取当前文件及所有轮转历史文件中的所有行（启动时重建内存索引用）。
   * 文件是 NDJSON：每行一条 JSON 记录。按行切分、丢空行后返回。
   */
  async readAllLines(): Promise<string[]> {
    const allLines: string[] = []
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8')
      // 每行末尾都有 \n，split 后最后会多一个空字符串元素；
      // filter(Boolean) 去掉空行，只保留真实 JSON 行。
      allLines.push(...raw.split('\n').filter(Boolean))
    } catch { /* 文件可能不存在（首次运行） */ }

    // 再读历史轮转文件。文件号是连续的：.0 存在才可能有 .1，
    // 所以读到不存在的文件直接 break，不用继续尝试。
    for (let i = 0; i < MAX_FILES; i++) {
      try {
        const rotated = this.rotatedPath(i)
        const rawFile = await fs.readFile(rotated, 'utf-8')
        allLines.push(...rawFile.split('\n').filter(Boolean))
      } catch {
        break
      }
    }
    return allLines
  }

  /** 清空所有日志文件：当前文件截断为空 + 删除全部历史文件。 */
  async clearAll(): Promise<void> {
    await fs.writeFile(this.filePath, '', 'utf-8')
    for (let i = 0; i < MAX_FILES; i++) {
      try {
        // unlink = 删除文件（POSIX 术语）。
        // 历史文件可能不存在（从未轮转过这么多），抛 ENOENT 时静默跳过。
        await fs.unlink(this.rotatedPath(i))
      } catch { }
    }
  }

  /** 文件路径（供 LogService 使用） */
  get file(): string {
    return this.filePath
  }

  /** 停止定时清理（应用退出时调用） */
  stop(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }

  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => { void this.rotateIfNeeded() }, CLEANUP_INTERVAL_MS)
    // unref：定时器不阻止进程退出（否则单靠定时器也会让应用无法完全退出）
    if (this.cleanupTimer.unref) this.cleanupTimer.unref()
  }

  /**
   * 轮转检查：当前文件达到 MAX_FILE_BYTES 时执行移位。
   * 只在定时器里触发（每 5 分钟），不做按写入量即时检查，
   * 因此当前文件最大可能到 10MB + 5 分钟内的写入量。
   *
   * 移位逻辑（倒序，避免覆盖还没搬走的文件）：
   *   .3 → .4，.2 → .3，.1 → .2，.0 → .1（最老的 .4 被覆盖丢弃）
   *   最后 当前文件 → .0，当前文件留空重新积累。
   * rename 失败静默忽略（如文件不存在），不阻塞后续步骤。
   */
  private async rotateIfNeeded(): Promise<void> {
    try {
      let size: number
      try {
        size = (await fs.stat(this.filePath)).size
      } catch { return } // 当前文件不存在（还没写过日志），无需轮转
      if (size < MAX_FILE_BYTES) return

      // 倒序移位：从最老的文件开始搬，保证每步 rename 的目标位置都已清空
      for (let i = MAX_FILES - 1; i >= 1; i--) {
        const older = this.rotatedPath(i)
        const newer = this.rotatedPath(i - 1)
        try { await fs.rename(newer, older) } catch { }
      }
      // 当前文件变成最新历史 .0，之后 append 会重新创建空的新当前文件
      try { await fs.rename(this.filePath, this.rotatedPath(0)) } catch { }
    } catch { }
  }

  /** 生成第 index 个历史文件的路径：app.trace.log.0 / .1 / ... */
  private rotatedPath(index: number): string {
    const ext = path.extname(this.filePath)
    const base = path.basename(this.filePath, ext)
    const dir = path.dirname(this.filePath)
    return path.join(dir, `${base}.${index}${ext}`)
  }
}
