import fs from 'fs/promises'
import path from 'path'
import { app } from 'electron'
import { BaseCallbackHandler } from '@langchain/core/callbacks/base'

export type TraceLevel = 'chain' | 'llm' | 'tool' | 'node' | 'error'

export type TraceEntry = {
  ts: number
  level: TraceLevel
  event: 'start' | 'end' | 'error'
  runId: string
  parentRunId?: string
  name?: string
  threadId?: string
  inputs?: unknown
  outputs?: unknown
  error?: string
  tags?: string[]
  metadata?: Record<string, unknown>
}

class TraceWriter {
  private filePath: string
  private writeChain: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  async append(entry: TraceEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n'
    this.writeChain = this.writeChain.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      await fs.appendFile(this.filePath, line, 'utf-8')
    })
    await this.writeChain
  }
}

export class AgentTraceLogger {
  private writer: TraceWriter

  constructor() {
    const filePath = path.join(app.getPath('userData'), 'agent-trace.jsonl')
    this.writer = new TraceWriter(filePath)
  }

  async log(
    level: TraceLevel,
    event: 'start' | 'end' | 'error',
    opts: {
      runId: string
      name?: string
      threadId?: string
      inputs?: unknown
      outputs?: unknown
      error?: string
    }
  ): Promise<void> {
    await this.writer.append({
      ts: Date.now(),
      level,
      event,
      ...opts,
    })
  }

  createCallbackHandler(): AgentTracerCallbackHandler {
    return new AgentTracerCallbackHandler(this)
  }
}

class AgentTracerCallbackHandler extends BaseCallbackHandler {
  name = 'AgentTracer'

  constructor(private logger: AgentTraceLogger) {
    super()
  }

  async onChainStart(
    chain: { name: string },
    inputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    await this.logger.log('chain', 'start', {
      runId,
      parentRunId,
      name: chain.name,
      inputs,
    })
  }

  async onChainEnd(
    outputs: Record<string, unknown>,
    runId: string,
    parentRunId?: string
  ): Promise<void> {
    await this.logger.log('chain', 'end', {
      runId,
      parentRunId,
      outputs,
    })
  }

  async onChainError(error: Error, runId: string, parentRunId?: string): Promise<void> {
    await this.logger.log('chain', 'error', {
      runId,
      parentRunId,
      error: error.message,
    })
  }
}
