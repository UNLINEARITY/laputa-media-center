/**
 * 用户数据库操作模块
 *
 * 提供用户的 CRUD 操作（单用户模式）
 */

import { nanoid } from 'nanoid'
import { hashPassword, verifyPassword } from '@/lib/auth/password'
import db from '../index'

export interface User {
  id: string
  username: string
  password_hash: string
  created_at: number
  updated_at: number
}

export class UsersRepository {
  /**
   * 检查是否已有用户（单用户模式）
   */
  hasUser(): boolean {
    const result = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
    return result.count > 0
  }

  /**
   * 创建用户（仅允许创建一次）
   *
   * @throws {Error} 如果已存在用户或用户名重复
   */
  async create(username: string, password: string): Promise<string> {
    if (this.hasUser()) {
      throw new Error('系统已有用户，不允许重复注册（单用户模式）')
    }

    const existingUser = this.getByUsername(username)
    if (existingUser) {
      throw new Error('用户名已存在')
    }

    const id = nanoid(10)
    const now = Date.now()
    const passwordHash = await hashPassword(password)

    db.prepare(`
      INSERT INTO users (id, username, password_hash, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, username, passwordHash, now, now)

    return id
  }

  /**
   * 根据 ID 获取用户
   */
  getById(id: string): User | null {
    const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as User | undefined

    return row || null
  }

  /**
   * 根据用户名获取用户
   */
  getByUsername(username: string): User | null {
    const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | User
      | undefined

    return row || null
  }

  /**
   * 验证用户登录
   *
   * @returns {string | null} 成功返回用户 ID，失败返回 null
   */
  async authenticate(username: string, password: string): Promise<string | null> {
    const user = this.getByUsername(username)

    if (!user) {
      return null
    }

    const isValid = await verifyPassword(password, user.password_hash)

    return isValid ? user.id : null
  }

  /**
   * 更新密码
   */
  async updatePassword(userId: string, newPassword: string): Promise<void> {
    const passwordHash = await hashPassword(newPassword)
    const now = Date.now()

    db.prepare(`
      UPDATE users
      SET password_hash = ?, updated_at = ?
      WHERE id = ?
    `).run(passwordHash, now, userId)
  }

  /**
   * 删除用户（级联删除所有相关数据）
   */
  delete(userId: string): void {
    db.prepare('DELETE FROM users WHERE id = ?').run(userId)
  }

  /**
   * 获取用户总数
   */
  count(): number {
    const result = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
    return result.count
  }
}

// 单例导出
export const usersRepo = new UsersRepository()
