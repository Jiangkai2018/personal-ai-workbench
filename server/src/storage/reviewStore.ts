// 复盘存储：每天每范围一个复盘文件 data/reviews/<date>-<scope>.md
// 复盘是"汇总执行"的产物，天然按天归档，用日期+范围作为文件名键
import matter from 'gray-matter'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Scope } from '../domain/types'

export interface GoalUpdate {
  goal_id: string
  title: string
  from: number
  to: number
}

export interface Review {
  id: string
  date: string
  scope: Scope
  /** 完成的任务数 */
  completed: number
  /** 目标进度更新明细 */
  goal_updates: GoalUpdate[]
  /** 一句话小结（列表展示） */
  summary: string
  /** 日小结正文（复盘时间线展示） */
  content: string
  created_at: string
}

export class ReviewStore {
  constructor(private readonly baseDir: string) {}

  private reviewsDir(): string {
    return path.join(this.baseDir, 'reviews')
  }

  /** id = YYYY-MM-DD-scope，一天一人一份 */
  static idFor(date: string, scope: Scope): string {
    return `${date}-${scope}`
  }

  private filePath(id: string): string {
    return path.join(this.reviewsDir(), `${id}.md`)
  }

  async get(id: string): Promise<Review | null> {
    try {
      const parsed = matter(await readFile(this.filePath(id), 'utf8'))
      return {
        ...(parsed.data as Record<string, unknown>),
        content: parsed.content.trim(),
      } as Review
    } catch {
      return null
    }
  }

  async save(review: Review): Promise<Review> {
    await mkdir(this.reviewsDir(), { recursive: true })
    const { content, ...front } = review
    await writeFile(this.filePath(review.id), matter.stringify(content, front as Record<string, unknown>), 'utf8')
    return review
  }

  /** 复盘时间线：按日期倒序 */
  async list(): Promise<Review[]> {
    const files = await readdir(this.reviewsDir()).catch(() => [])
    const reviews: Review[] = []
    for (const f of files.filter((f) => f.endsWith('.md'))) {
      const r = await this.get(f.replace(/\.md$/, ''))
      if (r) reviews.push(r)
    }
    reviews.sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0))
    return reviews
  }
}
