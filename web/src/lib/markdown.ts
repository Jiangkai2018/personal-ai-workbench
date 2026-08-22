// 迷你 markdown → HTML：只支持报告用到的子集（标题/加粗/斜体/列表/引用/分隔线）。
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

export function renderMarkdown(md: string): string {
  const lines = md.split(/\r?\n/)
  const out: string[] = []
  let listOpen: 'ul' | 'ol' | null = null

  const closeList = () => {
    if (listOpen) {
      out.push(`</${listOpen}>`)
      listOpen = null
    }
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (!line.trim()) {
      closeList()
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
