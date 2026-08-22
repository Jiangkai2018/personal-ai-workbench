// 鉴权路由：登录 / 登出 / 当前用户 / 家庭互证找回
// 无自助注册 —— 账号由 CLI（npm run add-user）创建
import { Router } from 'express'
import { z } from 'zod'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { UserStore } from '../../storage/userStore'
import {
  SESSION_COOKIE,
  JWT_MAX_AGE_MS,
  hashPassword,
  verifyPassword,
  signSession,
  verifySession,
  publicUser,
} from '../../auth/service'

/** 审计日志：data/audit/YYYY-MM-DD.md，追加式，git 历史即留痕 */
function auditFile(dataDir: string, d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return path.join(dataDir, 'audit', `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.md`)
}

export function authRouter(dataDir: string, secret: string): Router {
  const users = new UserStore(dataDir)
  const router = Router()

  const loginSchema = z.object({
    username: z.string().trim().min(1, '用户名不能为空'),
    password: z.string().min(1, '密码不能为空'),
  })

  // 登录：验证凭据 → 签发 JWT 写 httpOnly cookie
  router.post('/login', async (req, res, next) => {
    try {
      const parsed = loginSchema.parse(req.body)
      const user = await users.get(parsed.username)
      if (!user || !(await verifyPassword(parsed.password, user.password_hash))) {
        res.status(401).json({ error: 'INVALID_CREDENTIALS', message: '用户名或密码错误' })
        return
      }
      const token = signSession(
        { username: user.username, name: user.name, family: user.family },
        secret,
      )
      res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        sameSite: 'lax',
        maxAge: JWT_MAX_AGE_MS,
        path: '/',
      })
      res.json(publicUser(user))
    } catch (err) {
      next(err)
    }
  })

  // 登出：清 cookie
  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' })
    res.json({ ok: true })
  })

  // 当前用户：供前端启动时恢复会话
  router.get('/me', (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined
    const user = token ? verifySession(token, secret) : null
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED' })
      return
    }
    res.json(user)
  })

  const resetSchema = z.object({
    username: z.string().trim().min(1, '用户名不能为空'),
    new_password: z.string().min(8, '新密码至少 8 位'),
    family_username: z.string().trim().min(1, '请选择家人验证账号'),
    family_password: z.string().min(1, '家人密码不能为空'),
  })

  // 家庭互证找回：用另一位家人的密码验证后重置，写审计日志
  router.post('/reset-password', async (req, res, next) => {
    try {
      const parsed = resetSchema.parse(req.body)
      const target = await users.get(parsed.username)
      if (!target) {
        res.status(404).json({ error: 'NOT_FOUND' })
        return
      }
      const family = await users.get(parsed.family_username)
      // 目标必须是家庭成员，验证者必须是另一位家庭成员
      if (!target.family || !family?.family || family.username === target.username) {
        res.status(403).json({ error: 'FAMILY_VERIFY_FAILED' })
        return
      }
      if (!(await verifyPassword(parsed.family_password, family.password_hash))) {
        res.status(403).json({ error: 'FAMILY_VERIFY_FAILED' })
        return
      }
      await users.upsert({
        ...target,
        password_hash: await hashPassword(parsed.new_password),
      })
      await mkdir(path.dirname(auditFile(dataDir)), { recursive: true })
      await appendFile(
        auditFile(dataDir),
        `- ${new Date().toISOString()} reset_password target=${target.username} verified_by=${family.username}\n`,
        'utf8',
      )
      res.json({ ok: true })
    } catch (err) {
      next(err)
    }
  })

  return router
}
