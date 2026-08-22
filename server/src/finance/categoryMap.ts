// 分类规则表：账单来源分类 → 随手记分类。
// 随手记预置了与支付宝官方分类同名的「默认一级分类」组，支付宝规则几乎一一对应；
// 微信的"交易类型"是交易形式（商户消费/转账/扫码），除转账红包外全部走 AI 按 交易对方+商品 细分。
import categories from './data/categories.json'

export interface SsjCategory {
  name: string
  id: string
  type: 'Income' | 'Expense'
  parent: string
}

export const ALL_CATEGORIES = categories as SsjCategory[]

const byName = new Map<string, SsjCategory>()
for (const c of ALL_CATEGORIES) byName.set(c.name, c)

/** 按名称找分类（同名的默认分类组优先于更早的组——遍历顺序保证后者覆盖，默认组在数组尾部） */
export function findCategory(name: string, type: 'income' | 'expense'): SsjCategory | null {
  const hit = byName.get(name)
  if (hit && hit.type.toLowerCase() === type) return hit
  // 名称带「父>子」形式
  if (name.includes('>')) {
    const [parent, child] = name.split('>')
    const hit2 = ALL_CATEGORIES.find(
      (c) => c.parent === parent.trim() && c.name === child.trim() && c.type.toLowerCase() === type,
    )
    if (hit2) return hit2
  }
  return null
}

/** AI 兜底可选的分类清单（一级>二级 全名，按类型） */
export function aiCategoryOptions(type: 'income' | 'expense'): string[] {
  const t = type === 'income' ? 'Income' : 'Expense'
  return ALL_CATEGORIES.filter((c) => c.type === t && c.parent).map((c) => `${c.parent}>${c.name}`)
}

/** 兜底分类（AI 不可用/未命中时） */
export function fallbackCategory(type: 'income' | 'expense'): SsjCategory {
  return (
    findCategory(type === 'income' ? '其他收入' : '其他支出', type) ??
    (ALL_CATEGORIES.find((c) => c.type.toLowerCase() === type && !c.parent) as SsjCategory)
  )
}

/** 规则表：来源分类 → 随手记分类名（父>子 或 同名） */
const RULES: Record<string, { income?: string; expense?: string }> = {
  // —— 支付宝官方分类 → 随手记同名默认分类（预置镜像） ——
  日用百货: { expense: '日用百货' },
  餐饮美食: { expense: '餐饮美食' },
  交通出行: { expense: '交通出行' },
  数码电器: { expense: '数码电器' },
  美容美发: { expense: '美容美发' },
  母婴亲子: { expense: '母婴亲子' },
  服饰装扮: { expense: '服饰装扮' },
  家居家装: { expense: '家居家装' },
  文化休闲: { expense: '文化休闲' },
  住房物业: { expense: '住房物业' },
  爱车养车: { expense: '爱车养车' },
  充值缴费: { expense: '充值缴费' },
  账户存取: { expense: '账户存取' },
  生活服务: { expense: '生活服务' },
  公共服务: { expense: '公共服务' },
  商业服务: { expense: '商业服务' },
  亲友代付: { expense: '亲友代付' },
  医疗健康: { expense: '医疗健康' },
  转账红包: { expense: '转账红包-支出' },
  其他: { expense: '其他' },
  收入: { income: '其他收入' },
  // —— 微信交易形式 ——
  转账: { expense: '转账-支出', income: '其他收入' },
  // 微信红包细分放 AI（单发/群红包难辨），这里给安全默认
  微信红包: { expense: '微信红包（单发）' },
}

/** 规则表查询：返回随手记分类或 null（null = 该行交给 AI） */
export function ruleLookup(categorySource: string, type: 'income' | 'expense'): SsjCategory | null {
  const rule = RULES[categorySource]
  if (!rule) return null
  const target = type === 'income' ? rule.income : rule.expense
  if (!target) return null
  return findCategory(target, type)
}

/** 这些微信"交易形式"分类直接给安全默认，不浪费 AI */
const WECHAT_FORM_DEFAULT: Record<string, string> = {
  商户消费: '商户消费',
  扫二维码付款: '扫二维码付款',
}
export function wechatFormDefault(categorySource: string): SsjCategory | null {
  const name = WECHAT_FORM_DEFAULT[categorySource]
  return name ? findCategory(name, 'expense') : null
}
