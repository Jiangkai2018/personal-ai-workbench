// 实体存储：每个实体 = 一个带 YAML frontmatter 的 .md 文件（ADR-0001）
// 无数据库、无索引：读=遍历目录解析 frontmatter，写=写文件。个人规模足够。
import matter from 'gray-matter'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, readdir, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Entity } from '../domain/types'

function shortId(): string {
  return randomBytes(3).toString('hex')
}

function todayStamp(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}`
}

/** 实体目录名：idea → ideas、goal → goals、task → tasks、opportunity → opportunities */
const PLURAL: Record<string, string> = { opportunity: 'opportunities' }
function dirFor(type: string): string {
  return PLURAL[type] ?? `${type}s`
}

/** js-yaml 无法 dump undefined，写入前剔除 */
function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v
  }
  return out
}

export interface NewEntityInput {
  type: string
  body?: string
  [key: string]: unknown
}

export class EntityStore {
  constructor(private readonly baseDir: string) {}

  private entityDir(type: string): string {
    return path.join(this.baseDir, dirFor(type))
  }

  private filePath(type: string, id: string): string {
    return path.join(this.entityDir(type), `${id}.md`)
  }

  /** 新建实体：生成 id，写入 .md，返回完整实体（frontmatter + 正文 content） */
  async create(input: NewEntityInput): Promise<Entity> {
    const { type, body = '', ...data } = input
    const id = `${todayStamp()}-${type}-${shortId()}`
    // data 是宽松的 Record<string, unknown>（来自 YAML 的字段），合并后整表断言为 Entity
    const entity = {
      id,
      type,
      created_at: new Date().toISOString(),
      ...data,
      content: body,
    } as Entity
    await mkdir(this.entityDir(type), { recursive: true })
    const { content, ...front } = entity
    const raw = matter.stringify(content, compact(front))
    await writeFile(this.filePath(type, id), raw, 'utf8')
    return entity
  }

  /** 列出某类型全部实体（按文件名倒序 = 新的在前） */
  async list(type: string): Promise<Entity[]> {
    const dir = this.entityDir(type)
    const files = await readdir(dir).catch(() => [])
    const items: Entity[] = []
    for (const f of files.filter((f) => f.endsWith('.md'))) {
      const parsed = matter(await readFile(path.join(dir, f), 'utf8'))
      items.push({
        ...(parsed.data as Record<string, unknown>),
        content: parsed.content.trim(),
      } as Entity)
    }
    // 按创建时间倒序（ISO 字符串可字典序比较），同日用 id 兜底
    items.sort((a, b) => {
      if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0
    })
    return items
  }

  /** 按 id 读取单个实体；不存在返回 null */
  async get<T extends Entity = Entity>(type: string, id: string): Promise<T | null> {
    try {
      const parsed = matter(await readFile(this.filePath(type, id), 'utf8'))
      return {
        ...(parsed.data as Record<string, unknown>),
        content: parsed.content.trim(),
      } as T
    } catch {
      return null
    }
  }

  /**
   * 部分更新实体：patch 合并进 frontmatter，body 覆盖正文。
   * 不存在返回 null。后写覆盖（设计允许，git 历史兜底）。
   */
  async update<T extends Entity = Entity>(
    type: string,
    id: string,
    patch: Record<string, unknown>,
    body?: string,
  ): Promise<T | null> {
    const existing = await this.get<T>(type, id)
    if (!existing) return null
    const merged: T = { ...existing, ...patch, content: body ?? existing.content }
    const { content, ...front } = merged
    await writeFile(this.filePath(type, id), matter.stringify(content, compact(front)), 'utf8')
    return merged
  }

  /** 删除实体文件；不存在返回 false（幂等由调用方判断） */
  async remove(type: string, id: string): Promise<boolean> {
    try {
      await unlink(this.filePath(type, id))
      return true
    } catch {
      return false
    }
  }
}
