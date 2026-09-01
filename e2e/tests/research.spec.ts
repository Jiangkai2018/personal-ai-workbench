// 调研报告区 e2e（0901）：目录页渲染 + 静态可达 + 新 tab 打开 + 跨文件 href × 锚点 id 全量断言
// 硬约束来源：报告内的引用链接部署后必须能新 tab 跳转到引用文件并锚点定位（用户原话）
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../fixture'
import { login } from '../utils'

const RESEARCH_DIR = path.resolve(import.meta.dirname, '../../web/public/research')

/** 平台 → 报告/引用文件对：报告里所有跨文件 href 都必须落到引用文件的真实锚点上 */
const PAIRS = [
  { dir: 'jike', report: '即刻自媒体调研-深度分析.html', cited: '即刻自媒体调研-引用帖全文.html' },
  { dir: 'reddit', report: 'report.html', cited: 'highlights.html' },
  { dir: 'v2ex', report: 'report.html', cited: 'essence.html' },
]

/** 从 HTML 里收集跨文件引用：带锚点 href="xxx.html#anchor" 与整文件 href="xxx.html" */
function extractLinks(html: string): Array<{ file: string; anchor?: string }> {
  const out: Array<{ file: string; anchor?: string }> = []
  for (const m of html.matchAll(/href="([^"#]+\.html)(#[^"]*)?"/g)) {
    // 只统计相对链接（跨文件引用），外链 http(s) 不算
    if (/^(https?:)?\/\//i.test(m[1])) continue
    out.push({ file: m[1], anchor: m[2] ? decodeURIComponent(m[2].slice(1)) : undefined })
  }
  return out
}

/** 从 HTML 里收集全部 id="..." 锚点 */
function extractIds(html: string): Set<string> {
  return new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))
}

test.describe('调研报告区', () => {
  test('目录页：四平台卡片渲染，知乎占位，链接新 tab 打开', async ({ page, context }) => {
    await login(page)
    await page.goto('/research')

    await expect(page.getByTestId('research-page')).toBeVisible()
    for (const id of ['jike', 'zhihu', 'reddit', 'v2ex']) {
      await expect(page.getByTestId(`research-card-${id}`)).toBeVisible()
    }
    // 知乎置灰占位：卡片在但没有链接
    const zhihu = page.getByTestId('research-card-zhihu')
    await expect(zhihu.getByText('待补充', { exact: true })).toBeVisible()
    await expect(zhihu.getByTestId('research-link')).toHaveCount(0)
    // 三个平台各 2 个报告链接，且都是新 tab
    const links = page.getByTestId('research-link')
    await expect(links).toHaveCount(6)
    for (const link of await links.all()) {
      await expect(link).toHaveAttribute('target', '_blank')
    }

    // 点击首个链接 → 新 tab 打开静态报告本体
    const [report] = await Promise.all([context.waitForEvent('page'), links.first().click()])
    await report.waitForLoadState('load')
    expect(decodeURIComponent(report.url())).toContain('/research/jike/')
    expect(decodeURIComponent(report.url())).toContain('.html')
    await report.close()
  })

  test('静态报告全部可达（vite public 随构建服务）', async ({ request }) => {
    for (const p of PAIRS) {
      for (const f of [p.report, p.cited]) {
        const res = await request.get(`/research/${p.dir}/${encodeURIComponent(f)}`)
        expect(res.status(), `${p.dir}/${f}`).toBe(200)
      }
    }
  })

  test('核心：报告内全部跨文件引用 × 引用文件锚点 id 逐一匹配', async () => {
    for (const p of PAIRS) {
      const reportHtml = await readFile(path.join(RESEARCH_DIR, p.dir, p.report), 'utf8')
      const links = extractLinks(reportHtml)
      expect(links.length, `${p.dir} 报告应有跨文件引用`).toBeGreaterThan(0)

      // 按目标文件分组取 id 集（同目录静态托管，引用只可能指向本目录文件）
      const idsByFile = new Map<string, Set<string>>()
      for (const l of links) {
        if (!idsByFile.has(l.file)) {
          const target = await readFile(path.join(RESEARCH_DIR, p.dir, l.file), 'utf8')
          idsByFile.set(l.file, extractIds(target))
        }
      }

      const missing: string[] = []
      for (const l of links) {
        if (!l.anchor) continue
        if (!idsByFile.get(l.file)?.has(l.anchor)) missing.push(`${l.file}#${l.anchor}`)
      }
      expect(missing, `${p.dir} 报告里的引用锚点缺失：${missing.join(', ')}`).toEqual([])
    }
  })

  test('锚点定位：浏览器打开 引用文件#anchor 后目标元素存在', async ({ page }) => {
    // 取 jike 报告第一条带锚点的引用，直接以 URL 打开验证浏览器侧定位（hash 由浏览器解析）
    const reportHtml = await readFile(path.join(RESEARCH_DIR, 'jike', PAIRS[0].report), 'utf8')
    const first = extractLinks(reportHtml).find((l) => l.anchor)
    expect(first).toBeTruthy()

    await page.goto(`/research/jike/${encodeURIComponent(first!.file)}#${encodeURIComponent(first!.anchor!)}`)
    await page.waitForLoadState('load')
    const found = await page.evaluate((id: string) => Boolean(document.getElementById(id)), first!.anchor)
    expect(found, `锚点 #${first!.anchor} 应存在于 ${first!.file}`).toBe(true)
  })
})
