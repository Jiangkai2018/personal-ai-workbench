// T11 · 知识库页面全链路（0828-01 §1/§2）：树/阅读(表格+代码块)/编辑乐观锁/新建/回收站/二进制/上传→解析稿→Agent 可答
// 截图另存 local_docs/01.迭代任务/0828-01/docs/e2e/01.验证结果截图/
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { test, expect } from '../fixture'
import { login } from '../utils'

const DESKTOP = { viewport: { width: 1440, height: 900 } }
const SHOT_DIR = path.resolve(import.meta.dirname, '../../local_docs/01.迭代任务/0828-01/docs/e2e/01.验证结果截图')
const TMP = path.join(import.meta.dirname, '../.tmp-data')
const KB = path.join(TMP, 'knowledge')

async function seedKnowledge() {
  await mkdir(path.join(KB, '03.知识沉淀'), { recursive: true })
  await writeFile(
    path.join(KB, '03.知识沉淀', '补贴调研-20260829.md'),
    [
      '# 补贴调研',
      '',
      '| 项目 | 金额 |',
      '| --- | --- |',
      '| 房租补贴 | 800 |',
      '| 伙食补贴 | 300 |',
      '',
      '```python',
      'print("补贴计算")',
      '```',
      '',
    ].join('\n'),
    'utf8',
  )
  await writeFile(path.join(KB, '简历.pdf'), '%PDF-1.4 fake-binary', 'utf8')
}

async function shot(page: import('@playwright/test').Page, name: string) {
  await mkdir(SHOT_DIR, { recursive: true })
  await page.screenshot({ path: path.join(SHOT_DIR, name), fullPage: false })
}

test.describe('T11 知识库页面 · 桌面', () => {
  test.use(DESKTOP)

  test('C1 · 入口/骨架/阅读：树 + md 渲染（表格+代码块）+ 二进制条目', async ({ page }) => {
    await seedKnowledge()
    await login(page)
    await page.getByLabel('进入知识库').click()
    await expect(page).toHaveURL(/\/knowledge$/)
    await expect(page.getByTestId('kb-tree')).toBeVisible()

    // 树内既有二进制以附件式条目可见（决策 #14）
    await expect(page.getByTestId('kb-tree')).toContainText('简历.pdf')

    // 目录默认折叠：展开后再看子文件
    await page.getByTestId('kb-node').filter({ hasText: '03.知识沉淀' }).click()
    await expect(page.getByTestId('kb-tree')).toContainText('补贴调研-20260829.md')

    // 打开 md：表格与代码块由扩展后的 markdown.ts 渲染（决策 #13）
    await page.getByTestId('kb-node').filter({ hasText: '补贴调研-20260829.md' }).click()
    await expect(page.getByTestId('kb-reading')).toBeVisible()
    await expect(page.getByTestId('kb-reading').locator('th')).toHaveText(['项目', '金额'])
    await expect(page.getByTestId('kb-reading').locator('td').filter({ hasText: '房租补贴' })).toBeVisible()
    await expect(page.getByTestId('kb-reading').locator('pre code')).toContainText('补贴计算')
    await shot(page, 'F-08-阅读-表格与代码块.png')
  })

  test('C2 · 编辑保存持久化 + 乐观锁 409 冲突提示', async ({ page }) => {
    await seedKnowledge()
    await login(page)
    await page.goto('/knowledge')
    await page.getByTestId('kb-node').filter({ hasText: '03.知识沉淀' }).click()
    await page.getByTestId('kb-node').filter({ hasText: '补贴调研-20260829.md' }).click()
    await expect(page.getByTestId('kb-reading')).toBeVisible()

    await page.getByTestId('kb-edit').click()
    const editor = page.getByTestId('kb-editor')
    await expect(editor).toBeVisible()
    await editor.fill('# 补贴调研\n\n新增一行：家属补贴 200 元。\n')
    await page.getByTestId('kb-save').click()
    await expect(page.getByTestId('kb-notice')).toContainText('已保存')
    await expect(page.getByTestId('kb-reading')).toContainText('家属补贴')

    // 刷新后仍在（落盘验证）
    await page.reload()
    await page.getByTestId('kb-node').filter({ hasText: '03.知识沉淀' }).click()
    await page.getByTestId('kb-node').filter({ hasText: '补贴调研-20260829.md' }).click()
    await expect(page.getByTestId('kb-reading')).toContainText('家属补贴')

    // 乐观锁：人在编辑时 Agent（这里用 fs 模拟）并发落盘 → 保存 409 → 提示刷新
    await page.getByTestId('kb-edit').click()
    await expect(page.getByTestId('kb-editor')).toBeVisible()
    await writeFile(
      path.join(KB, '03.知识沉淀', '补贴调研-20260829.md'),
      '# 补贴调研\n\nAgent 已更新本文件。\n',
      'utf8',
    )
    await page.getByTestId('kb-editor').fill('# 我的本地修改\n')
    await page.getByTestId('kb-save').click()
    await expect(page.getByTestId('kb-error')).toContainText('文件已被修改')
    await page.getByTestId('kb-reload').click()
    await expect(page.getByTestId('kb-editor')).toContainText('Agent 已更新本文件')
    await shot(page, 'F-09-编辑-乐观锁冲突.png')
  })

  test('C3 · 新建/删除→回收站→恢复→彻底删除', async ({ page }) => {
    await seedKnowledge()
    await login(page)
    await page.goto('/knowledge')

    // 新建目录 + 文件
    await page.getByTestId('kb-new-dir').click()
    await page.getByTestId('kb-new-name').fill('01.临时')
    await page.getByTestId('kb-new-confirm').click()
    await expect(page.getByTestId('kb-tree')).toContainText('01.临时')

    await page.getByTestId('kb-new-file').click()
    await page.getByTestId('kb-new-name').fill('随手记-20260829.md')
    await page.getByTestId('kb-new-confirm').click()
    await expect(page.getByTestId('kb-reading')).toBeVisible() // 建完自动打开（阅读态）

    // 删除 → 回收站（树行内的删除按钮 aria-label 带文件名，精确定位）
    await page.getByTestId('kb-node').filter({ hasText: '随手记-20260829.md' }).click()
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: '删除 随手记-20260829.md' }).click()
    await expect(page.getByTestId('kb-notice')).toContainText('已移入回收站')

    await page.getByTestId('kb-trash-toggle').click()
    await expect(page.getByTestId('kb-trash-list')).toContainText('随手记-20260829.md')

    // 恢复 → 文件回树
    await page.getByTestId('kb-restore').first().click()
    await expect(page.getByTestId('kb-notice')).toContainText('已恢复到')
    await expect(page.getByTestId('kb-tree')).toContainText('随手记-20260829.md')
    await shot(page, 'F-10-新建删除恢复.png')

    // 再删 → 彻底删除 → 消失
    await page.getByTestId('kb-node').filter({ hasText: '随手记-20260829.md' }).click()
    page.once('dialog', (d) => d.accept())
    await page.getByRole('button', { name: '删除 随手记-20260829.md' }).click()
    await expect(page.getByTestId('kb-trash-list')).toContainText('随手记-20260829.md')
    page.once('dialog', (d) => d.accept())
    await page.getByTestId('kb-purge').first().click()
    await expect(page.getByTestId('kb-trash-list')).not.toContainText('随手记-20260829.md')
  })

  test('C4 · 二进制文件：附件式卡片 + 下载', async ({ page }) => {
    await seedKnowledge()
    await login(page)
    await page.goto('/knowledge')
    await page.getByTestId('kb-node').filter({ hasText: '简历.pdf' }).click()
    await expect(page.getByTestId('kb-binary')).toBeVisible()
    const href = await page.getByTestId('kb-binary').locator('a').getAttribute('href')
    expect(href).toContain('/api/knowledge/raw?path=')

    // 下载字节一致
    const res = await page.request.get(href!)
    expect(res.status()).toBe(200)
    expect(await res.text()).toBe('%PDF-1.4 fake-binary')
    await shot(page, 'F-14-二进制-下载.png')
  })

  test('C5 · 上传：md 直接入树 + csv 解析稿（表格）→ Agent 会话可答其内容', async ({ page }) => {
    test.setTimeout(150_000) // Agent 走真实模型，放慢节拍
    await seedKnowledge()
    await login(page)
    await page.goto('/knowledge')

    const fileInput = page.locator('input[type=file]')
    await fileInput.setInputFiles([
      { name: '直传笔记.md', mimeType: 'text/markdown', buffer: Buffer.from('# 直传的笔记\n\n内容本身。\n') },
      { name: '月度开销.csv', mimeType: 'text/csv', buffer: Buffer.from('项目,金额\n房租,3000\n') },
    ])
    const panel = page.getByTestId('kb-upload-panel')
    await expect(panel).toBeVisible()
    await expect(panel).toContainText('直传笔记.md')
    await expect(panel).toContainText('月度开销.csv')
    await shot(page, 'F-15-上传-结果列表.png')

    // md 直接入树（决策 #15）：树内可见、内容原样
    await page.getByTestId('kb-node').filter({ hasText: '直传笔记.md' }).first().click()
    await expect(page.getByTestId('kb-reading')).toContainText('内容本身')

    // csv 解析稿：带来源头 + md 表格
    const draftBtn = panel.getByRole('button', { name: /打开 .*月度开销/ })
    await draftBtn.click()
    await expect(page.getByTestId('kb-reading')).toContainText('来源原件')
    await expect(page.getByTestId('kb-reading').locator('td').filter({ hasText: '3000' })).toBeVisible()
    await shot(page, 'F-13-csv解析稿-表格.png')

    // Agent 会话可答其内容（走真实模型，与 t10 同款约定）
    await page.getByLabel('进入 AI Agent').click()
    await page.getByTestId('ag-new-thread').click()
    const composer = page.getByTestId('ag-composer-input')
    await expect(composer).toBeFocused({ timeout: 15_000 })
    await composer.fill('请用知识库工具查一下月度开销.csv 里的房租金额是多少，只回答数字。')
    await page.getByTestId('ag-send').click()
    await expect(page.getByText('3000').first()).toBeVisible({ timeout: 90_000 })
    await shot(page, 'F-21-Agent可答上传内容.png')
  })
})

test.describe('T11 知识库页面 · 移动端 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('C6 · 窄屏抽屉目录 + 无横向滚动', async ({ page }) => {
    await seedKnowledge()
    await login(page)
    await page.goto('/knowledge')

    const drawerBtn = page.getByTestId('kb-drawer-btn')
    await expect(drawerBtn).toBeVisible()
    await expect(page.getByTestId('kb-tree')).toBeHidden()
    await drawerBtn.click()
    await expect(page.getByTestId('kb-tree')).toBeVisible()
    await page.getByTestId('kb-node').filter({ hasText: '03.知识沉淀' }).click()
    await expect(page.getByTestId('kb-tree')).toContainText('补贴调研-20260829.md')
    await shot(page, 'F-07-移动端抽屉目录.png')

    // 点文件 → 抽屉收起 → 阅读态
    await page.getByTestId('kb-node').filter({ hasText: '补贴调研-20260829.md' }).click()
    await expect(page.getByTestId('kb-tree')).toBeHidden()
    await expect(page.getByTestId('kb-reading')).toBeVisible()

    const hScroll = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    )
    expect(hScroll, '不得出现横向滚动').toBeFalsy()
  })
})
