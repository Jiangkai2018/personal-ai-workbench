// 登录守卫：所有 /api/*（除 /api/auth）都走这里
import type { NextFunction, Request, Response } from 'express'
import { SESSION_COOKIE, verifySession, type SessionUser } from '../auth/service'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser
    }
  }
}

export function requireAuth(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE] as string | undefined
    const user = token ? verifySession(token, secret) : null
    if (!user) {
      res.status(401).json({ error: 'UNAUTHORIZED', message: '请先登录' })
      return
    }
    req.user = user
    next()
  }
}
