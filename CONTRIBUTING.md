# 贡献指南

感谢你愿意为「个人 AI 工作台」做贡献！这是一个本地优先的个人成长闭环项目，贡献前请先读 [README](README.md) 了解核心理念，特别是两条设计原则：**承诺类动作必须人工确认**、**一切皆文件**。

## 开发环境

- Node.js ≥ 22
- 推荐用 Git Bash / WSL（部分脚本为 bash）

```bash
npm install          # 一次装好 server / web / e2e 三个 workspace
npm run dev          # 启动后端(3000) + 前端(5173)
```

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 开发模式（server + web） |
| `npm run test` | 后端单测（vitest + supertest） |
| `npm run e2e` | 端到端测试（Playwright，隔离数据目录） |
| `npm run lint` | ESLint 检查（web + server） |
| `npm run build` | 构建全部包 |

## 提交 PR 前的自查清单

- [ ] `npm run lint` 无报错
- [ ] `npm run test` 全绿
- [ ] 涉及 UI 的改动跑过 `npm run e2e`
- [ ] 新功能有对应测试（单测或 e2e 至少其一）
- [ ] 不引入新的运行时依赖除非确有必要（本项目刻意保持轻依赖）

## 代码约定

- **语言**：TypeScript 严格模式；注释与文档用中文
- **风格**：单引号、无分号、行宽 100（Prettier 配置见 `.prettierrc`）
- **存储**：任何新实体类型必须走 `EntityStore`（一个实体一个 `.md` 文件），不引入数据库
- **API**：新路由必须用 zod 校验请求体，错误经统一错误处理返回
- **UI**：样式写在 `web/src/index.css` 全局设计系统里（CSS 变量 + 语义类名），不引入 CSS 框架
- **测试**：接口测试用临时目录（`mkdtemp`），绝不读写真实 `data/`

## 提交信息规范

用中文或英文均可，但请说清"做了什么"：

```
feat: 机会页支持按总分排序
fix: 任务分桶 future 与 week 互斥
docs: 补充 ADR-0003 双远程推送策略
refactor: 抽取评分维度为常量
test: 补家庭范围切换的 e2e
chore: 升级 vite 到 6.0.9
```

## 分支模型

- `main`：稳定分支，PR 合并目标
- 功能分支：`feat/<短描述>` / `fix/<短描述>`

## 报告 Bug / 提需求

提 Issue 请使用模板（bug 报告附复现步骤；功能需求说清场景与动机）。安全相关问题请勿公开讨论，见 [SECURITY 说明](README.md#安全)。

## 许可

提交即表示你同意贡献内容以 [MIT License](LICENSE) 发布。
