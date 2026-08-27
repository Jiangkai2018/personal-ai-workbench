// 会话线程存储：每会话一个 JSON 文件（ADR-0004）
// 读 = 遍历目录解析；写 = 整文件覆写。与 EntityStore 同一信条，只是载体从 md 换成 json。
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { AgentThread, ThreadMeta } from './types'

/** id 白名单：字母数字连字符下划线，防路径穿越 */
const ID_RE = /^[a-zA-Z0-9_-]{1,80}$/

function threadPath(baseDir: string, id: string): string {
  return path.join(baseDir, `${id}.json`)
}

function todayStamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
}

export class ThreadStore {
  constructor(private readonly baseDir: string) {}

  /** 新建空线程；id 可由客户端指定（前端生成 uuid），也可省略由服务端生成 */
  async create(id?: string): Promise<AgentThread> {
    const finalId = id && ID_RE.test(id) ? id : `${todayStamp()}-agent-${randomBytes(3).toString('hex')}`
    const existing = await this.get(finalId)
    if (existing) return existing
    const now = new Date().toISOString()
    const thread: AgentThread = {
      id: finalId,
      title: '新对话',
      created_at: now,
      updated_at: now,
      messages: [],
    }
    await mkdir(this.baseDir, { recursive: true })
    await writeFile(threadPath(this.baseDir, finalId), JSON.stringify(thread, null, 2), 'utf8')
    return thread
  }

  async get(id: string): Promise<AgentThread | null> {
    if (!ID_RE.test(id)) return null
    try {
      const parsed = JSON.parse(await readFile(threadPath(this.baseDir, id), 'utf8')) as Partial<AgentThread>
      // 容错：老文件缺字段落默认值
      return {
        id,
        title: '新对话',
        created_at: '',
        updated_at: '',
        messages: [],
        ...parsed,
      } as AgentThread
    } catch {
      return null
    }
  }

  /** 全量覆写（消息流 + 元信息）；updated_at 由这里统一盖章 */
  async save(thread: AgentThread): Promise<void> {
    await mkdir(this.baseDir, { recursive: true })
    await writeFile(
      threadPath(this.baseDir, thread.id),
      JSON.stringify({ ...thread, updated_at: new Date().toISOString() }, null, 2),
      'utf8',
    )
  }

  /** 列表元信息（剥掉消息体），按更新时间倒序 */
  async listMeta(): Promise<ThreadMeta[]> {
    const files = await readdir(this.baseDir).catch(() => [])
    const items: ThreadMeta[] = []
    for (const f of files.filter((f) => f.endsWith('.json'))) {
      try {
        const t = JSON.parse(await readFile(path.join(this.baseDir, f), 'utf8')) as AgentThread
        items.push({
          id: t.id,
          title: t.title ?? '新对话',
          created_at: t.created_at ?? '',
          updated_at: t.updated_at ?? '',
          archived: t.archived,
          model: t.model,
          usage: t.usage,
        })
      } catch {
        // 单文件损坏不拖垮列表
      }
    }
    items.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    return items
  }

  async remove(id: string): Promise<boolean> {
    if (!ID_RE.test(id)) return false
    try {
      await unlink(threadPath(this.baseDir, id))
      return true
    } catch {
      return false
    }
  }
}
