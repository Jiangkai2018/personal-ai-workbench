// 内存运行表单测（0828-01 §3.2）：会话互斥 / 全局上限 / 手动停止打标 / 完成清理
import { describe, expect, it } from 'vitest'
import { RunRegistry } from './runRegistry'

describe('运行表', () => {
  it('同一会话运行互斥（busy），finish 后可再跑', () => {
    const reg = new RunRegistry(3)
    expect(reg.start('t1', true)).toBe('ok')
    expect(reg.start('t1', false)).toBe('busy') // 上一轮还在后台运行 → 409
    reg.finish('t1')
    expect(reg.start('t1', false)).toBe('ok')
  })

  it('全局后台上限：超限拒绝 push 运行（limit），finish 腾出名额；普通运行不受限', () => {
    const reg = new RunRegistry(2)
    expect(reg.start('a', true)).toBe('ok')
    expect(reg.start('b', true)).toBe('ok')
    expect(reg.start('c', true)).toBe('limit')
    expect(reg.start('c', false)).toBe('ok') // 交互式运行不受后台名额约束
    reg.finish('a')
    reg.finish('b')
    expect(reg.start('d', true)).toBe('ok') // 名额已腾出（c 仍占一个）
  })

  it('stop 打标 manualStop 并返回可停状态；重复 stop 返回 false', () => {
    const reg = new RunRegistry(3)
    expect(reg.stop('ghost')).toBe(false)
    reg.start('t1', true)
    expect(reg.stop('t1')).toBe(true)
    expect(reg.state('t1')?.manualStop).toBe(true)
    expect(reg.stop('t1')).toBe(false)
  })

  it('state 暴露 running/startedAt/push；finish 后清空', async () => {
    const reg = new RunRegistry(3)
    reg.start('t1', true)
    expect(reg.state('t1')?.running).toBe(true)
    expect(reg.state('t1')?.push).toBe(true)
    expect(reg.state('t1')?.startedAt).toBeGreaterThan(0)
    reg.finish('t1')
    expect(reg.state('t1')?.running ?? false).toBe(false)
  })
})
