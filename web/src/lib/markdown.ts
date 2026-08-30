// 迷你 markdown → HTML：支持报告/知识文件用到的子集
// （标题/加粗/斜体/列表/引用/分隔线/GFM 表格/围栏代码块，0828-01 决策 #13 补齐后两项）。
// 刻意不引渲染库（CONTRIBUTING：不轻易加运行时依赖）；先全量转义再逐行组装。

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 行内：加粗 / 斜体 / 行内代码 */
function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

/** 剥离文档头部的 YAML frontmatter（知识文件元信息不渲染进正文） */
function stripFrontmatter(md: string): string {
  if (!md.startsWith('---')) return md
  // 从第 4 字符起找关闭围栏，避免命中开头那道 ---
  const rest = md.slice(3)
  const m = rest.match(/^[ \t]*---[ \t]*\r?$/m)
  if (!m || m.index === undefined) return md
  return rest.slice(m.index + m[0].length).replace(/^\r?\n/, '')
}

/** 表格分隔行：| --- | :--: | 形态（GFM 允许 ≥1 个连字符），且列数与表头一致才算 */
function isTableSeparator(line: string, columns: number): boolean {
  const cells = line.trim().replace(/^\||\|$/g, '').split('|')
  if (cells.length !== columns) return false
  return cells.every((c) => /^\s*:?-+:?\s*$/.test(c))
}

function splitRow(line: string): string[] {
  return line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
}

export function renderMarkdown(input: string): string {
  const md = stripFrontmatter(input)
  const lines = md.split(/\r?\n/)
  const out: string[] = []
  let listOpen: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (listOpen) {
      out.push(`</${listOpen}>`)
      listOpen = null
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd()

    // 围栏代码块：``` 开关，内部只转义不渲染；未闭合到文末都算
    if (/^```/.test(line.trim())) {
      closeList()
      const lang = line.trim().slice(3).trim()
      const code: string[] = []
      i++
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        code.push(lines[i])
        i++
      }
      const cls = lang ? ` class="language-${escapeHtml(lang)}"` : ''
      out.push(`<pre><code${cls}>${escapeHtml(code.join('\n'))}</code></pre>`)
      continue
    }

    if (!line.trim()) {
      closeList()
      continue
    }

    // GFM 表格：当前行是 |…| 且下一行是列数一致的分隔行
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && isTableSeparator(lines[i + 1], splitRow(line).length)) {
      closeList()
      const header = splitRow(line)
      i += 2 // 跳过表头与分隔行
      const body: string[] = []
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
        const cells = splitRow(lines[i])
        body.push('<tr>' + header.map((_, ci) => `<td>${inline(cells[ci] ?? '')}</td>`).join('') + '</tr>')
        i++
      }
      i--
      out.push(
        [
          '<table>',
          '<thead>',
          '<tr>' + header.map((h) => `<th>${inline(h)}</th>`).join('') + '</tr>',
          '</thead>',
          '<tbody>',
          ...body,
          '</tbody>',
          '</table>',
        ].join('\n'),
      )
      continue
    }

    // 标题
    const heading = line.match(/^(#{1,4})\s+(.*)$/)
    if (heading) {
      closeList()
      const level = Math.min(heading[1].length + 1, 5) // 报告 h1 降一级，页内留 h1 给标题
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    // 分隔线
    if (/^(---+|\*\*\*+)$/.test(line.trim())) {
      closeList()
      out.push('<hr />')
      continue
    }

    // 引用块（报告头部的免责声明）
    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      closeList()
      out.push(`<blockquote>${inline(quote[1])}</blockquote>`)
      continue
    }

    // 无序 / 有序列表
    const ul = line.match(/^\s*[-*]\s+(.*)$/)
    const ol = line.match(/^\s*\d+[.、]\s+(.*)$/)
    if (ul || ol) {
      const want: 'ul' | 'ol' = ul ? 'ul' : 'ol'
      if (listOpen !== want) {
        closeList()
        out.push(`<${want}>`)
        listOpen = want
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`)
      continue
    }

    closeList()
    out.push(`<p>${inline(line)}</p>`)
  }
  closeList()
  return out.join('\n')
}
