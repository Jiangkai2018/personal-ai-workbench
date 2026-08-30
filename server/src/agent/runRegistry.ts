// 内存运行表（0828-01 §3.2 / ADR-0008）：threadId → 运行态
// 会话互斥、全局后台并发上限、手动停止打标；服务重启即清空（v1 接受，status 退回 not-running）。
export interface RunState {
  running: boolean
  startedAt: number
  /** 本轮开启了「完成后推送」 */
  push: boolean
  /** 手动停止打标：不推送 */
  manualStop: boolean
}

export type StartResult = 'ok' | 'busy' | 'limit'

export class RunRegistry {
  private runs = new Map<string, RunState>()

  constructor(private readonly globalLimit: number) {}

  /** 占位开跑；同会话已在跑 → busy（互斥），后台满员 → limit（push 提交拒绝） */
  start(threadId: string, push: boolean): StartResult {
    if (this.runs.get(threadId)?.running) return 'busy'
    if (push && this.count() >= this.globalLimit) return 'limit'
    this.runs.set(threadId, { running: true, startedAt: Date.now(), push, manualStop: false })
    return 'ok'
  }

  state(threadId: string): RunState | null {
    const r = this.runs.get(threadId)
    return r && r.running ? r : null
  }

  /** 手动停止：打标 + 返回是否确有运行在停 */
  stop(threadId: string): boolean {
    const r = this.runs.get(threadId)
    if (!r?.running || r.manualStop) return false
    r.manualStop = true
    return true
  }

  finish(threadId: string): void {
    this.runs.delete(threadId)
  }

  count(): number {
    let n = 0
    for (const r of this.runs.values()) if (r.running) n++
    return n
  }
}
