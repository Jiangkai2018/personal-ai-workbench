// 登录防爆破：按来源 IP 的阶梯锁定。
// 3 错锁 3 分钟 → 5 错锁 1 小时 → 7 错锁 1 周 → 10 错永久封禁；
// 登录成功清零计数。永久封禁持久化到 data/security/banned.md（重启不丢）。
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import matter from 'gray-matter'

/** 阶梯：累计错误数 → 锁定时长（毫秒）；最后一档 Number.POSITIVE_INFINITY = 永久 */
const TIERS: { fails: number; ms: number; label: string }[] = [
  { fails: 3, ms: 3 * 60_000, label: '3 分钟' },
  { fails: 5, ms: 60 * 60_000, label: '1 小时' },
  { fails: 7, ms: 7 * 24 * 60 * 60_000, label: '1 周' },
  { fails: 10, ms: Number.POSITIVE_INFINITY, label: '永久' },
]

interface IpState {
  fails: number
  lockedUntil: number
  permanent: boolean
}

export class LoginLimiter {
  private states = new Map<string, IpState>()
  private bannedFile: string | null = null

  /** 永久封禁落盘目录（dataDir）；不传则仅内存（测试用） */
  withPersistence(dataDir: string): this {
    this.bannedFile = path.join(dataDir, 'security', 'banned.md')
    void this.loadBanned()
    return this
  }

  private async loadBanned(): Promise<void> {
    if (!this.bannedFile) return
    try {
      const parsed = matter(await readFile(this.bannedFile, 'utf8'))
      for (const ip of (parsed.data.ips as string[]) ?? []) {
        this.states.set(ip, { fails: TIERS.at(-1)!.fails, lockedUntil: 0, permanent: true })
      }
    } catch {
      // 无文件 = 无历史封禁
    }
  }

  private async persistBanned(): Promise<void> {
    if (!this.bannedFile) return
    const ips = [...this.states.entries()].filter(([, s]) => s.permanent).map(([ip]) => ip)
    await mkdir(path.dirname(this.bannedFile), { recursive: true })
    await writeFile(
      this.bannedFile,
      matter.stringify('# 登录防爆破：永久封禁 IP 清单（自动维护）', { ips }),
      'utf8',
    )
  }

  /** 请求前检查：是否放行；不放行时返回可读提示 */
  check(ip: string, now = Date.now()): { allowed: true } | { allowed: false; message: string } {
    const s = this.states.get(ip)
    if (!s) return { allowed: true }
    if (s.permanent) {
      return { allowed: false, message: '访问已被永久禁止（累计错误次数过多）' }
    }
    if (s.lockedUntil > now) {
      const left = Math.ceil((s.lockedUntil - now) / 60_000)
      return {
        allowed: false,
        message: left >= 60 ? `尝试过于频繁，已锁定，请 ${Math.ceil(left / 60)} 小时后再试` : `尝试过于频繁，已锁定 ${left + 1} 分钟后再试`,
      }
    }
    return { allowed: true }
  }

  /** 密码校验失败后调用：累计并按阶梯加锁 */
  onFail(ip: string, now = Date.now()): void {
    const s = this.states.get(ip) ?? { fails: 0, lockedUntil: 0, permanent: false }
    s.fails += 1
    for (const tier of TIERS) {
      if (s.fails === tier.fails) {
        if (Number.isFinite(tier.ms)) {
          s.lockedUntil = now + tier.ms
        } else {
          s.permanent = true
        }
      }
    }
    this.states.set(ip, s)
    if (s.permanent) void this.persistBanned()
  }

  /** 登录成功：清零（真人偶尔输错不应被累积误伤） */
  onSuccess(ip: string): void {
    this.states.delete(ip)
  }
}
