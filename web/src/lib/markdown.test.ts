// markdown.ts 渲染单测（0828-01 决策 #13）：GFM 表格 + 围栏代码块为本次新增，其余为存量语法回归
import { describe, expect, it } from 'vitest'
import { renderMarkdown } from './markdown'

describe('GFM 表格（新增）', () => {
  it('表头 + 分隔行 + 数据行 → table 结构，单元格做行内渲染与转义', () => {
    const html = renderMarkdown('| 项目 | 金额 |\n| --- | --- |\n| **房租** | 3000 |\n| 伙食 | <b> |\n')
    expect(html).toContain('<table>')
    expect(html).toContain('<thead>')
    expect(html).toContain('<th>项目</th>')
    expect(html).toContain('<th>金额</th>')
    expect(html).toContain('<tbody>')
    expect(html).toContain('<td><strong>房租</strong></td>')
    expect(html).toContain('<td>3000</td>')
    expect(html).toContain('&lt;b&gt;')
    expect(html).toContain('</table>')
  })

  it('对齐冒号不输出到表头', () => {
    const html = renderMarkdown('| A | B |\n| :-- | --: |\n| 1 | 2 |\n')
    expect(html).toContain('<th>A</th>')
    expect(html).toContain('<th>B</th>')
    expect(html).not.toContain('--')
  })

  it('分隔行列数与表头不一致 → 不当表格（保持原文段落）', () => {
    const html = renderMarkdown('| A | B |\n| --- |\n| 1 | 2 |\n')
    expect(html).not.toContain('<table>')
  })
})

describe('围栏代码块（新增）', () => {
  it('``` 包裹 → pre>code，内容只做 HTML 转义不做行内渲染', () => {
    const md = ['```python', 'def f(x):', '  return x ** 2  # **bold** 不生效', '```'].join('\n')
    const html = renderMarkdown(md)
    expect(html).toContain('<pre><code')
    expect(html).toContain('def f(x):')
    expect(html).toContain('x ** 2  # **bold** 不生效')
    expect(html).not.toContain('<strong>')
  })

  it('未闭合围栏：到文末都算代码', () => {
    const html = renderMarkdown('```\nconst a = 1;\n')
    expect(html).toContain('const a = 1;')
    expect(html).toContain('</code></pre>')
  })

  it('空围栏内空行保留', () => {
    const html = renderMarkdown('```\na\n\nb\n```')
    expect(html).toContain('a\n\nb')
  })
})

describe('存量语法回归', () => {
  it('标题/列表/引用/分隔线/行内样式不受新语法影响', () => {
    const html = renderMarkdown('# 大标题\n\n- 甲\n- 乙\n\n> 引用\n\n---\n\n*斜体* 与 `code`\n')
    expect(html).toContain('<h2>大标题</h2>')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>甲</li>')
    expect(html).toContain('<blockquote>引用</blockquote>')
    expect(html).toContain('<hr />')
    expect(html).toContain('<em>斜体</em>')
    expect(html).toContain('<code>code</code>')
  })

  it('含 frontmatter 的知识文件：frontmatter 整块剥离不进正文', () => {
    const html = renderMarkdown('---\ntitle: 笔记\ntags: [a]\n---\n\n# 正文\n')
    expect(html).toContain('<h2>正文</h2>')
    expect(html).not.toContain('title: 笔记')
    expect(html).not.toContain('<table>')
  })
})
