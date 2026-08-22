// 用户存储：每个用户 = 一个带 YAML frontmatter 的 .md 文件（data/users/<username>.md）
// 与实体同构（ADR-0001），密码只存 bcrypt 哈希；审计日志独立于用户文件。
import matter from 'gray-matter'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export interface User {
  /** 登录名 */
  username: string
  /** 显示名（江凯 / 妻子） */
  name: string
  /** bcrypt 哈希，永不回传前端 */
  password_hash: string
  /** 是否为家庭成员（互证找回的基础：重置需另一位家人验证） */
  family: boolean
  created_at: string
}

export class UserStore {
  constructor(private readonly baseDir: string) {}

  private usersDir(): string {
    return path.join(this.baseDir, 'users')
  }

  private filePath(username: string): string {
    return path.join(this.usersDir(), `${username}.md`)
  }

  async get(username: string): Promise<User | null> {
    try {
      const parsed = matter(await readFile(this.filePath(username), 'utf8'))
      return parsed.data as unknown as User
    } catch {
      return null
    }
  }

  async upsert(user: User): Promise<User> {
    await mkdir(this.usersDir(), { recursive: true })
    await writeFile(
      this.filePath(user.username),
      matter.stringify('', user as unknown as Record<string, unknown>),
      'utf8',
    )
    return user
  }

  async list(): Promise<User[]> {
    const files = await readdir(this.usersDir()).catch(() => [])
    const users: User[] = []
    for (const f of files.filter((f) => f.endsWith('.md'))) {
      const u = await this.get(f.replace(/\.md$/, ''))
      if (u) users.push(u)
    }
    return users
  }
}
