// 鉴权核心：bcrypt 哈希 + JWT session（httpOnly cookie）
// 设计：账号密码登录、JWT 存 httpOnly cookie、无自助注册（CLI 建号）
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import type { User } from '../storage/userStore'

export const SESSION_COOKIE = 'workbench_session'
export const JWT_MAX_AGE_MS = 7 * 24 * 3600 * 1000

export function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 10)
}

export function verifyPassword(pw: string, hash: string): Promise<boolean> {
  return bcrypt.compare(pw, hash)
}

/** session 里携带的用户身份（不包含密码哈希） */
export interface SessionUser {
  username: string
  name: string
  family: boolean
}

export function signSession(user: SessionUser, secret: string): string {
  return jwt.sign(user, secret, { expiresIn: '7d' })
}

export function verifySession(token: string, secret: string): SessionUser | null {
  try {
    return jwt.verify(token, secret) as SessionUser
  } catch {
    return null
  }
}

/** 去掉密码哈希，只回传可展示字段 */
export function publicUser(user: User): SessionUser & { created_at: string } {
  const { password_hash: _ph, ...rest } = user
  return rest
}
