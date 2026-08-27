# 个人 AI 工作台

> 本地优先的个人成长闭环系统：**想法 → 机会 → 目标 → 任务 → 每日执行 → 复盘 → 沉淀 → 反哺目标**。
> 无数据库、无自助注册，数据是仓库里的 Markdown 文件 —— 你是自己数据的唯一所有者。

[![CI](https://github.com/Jiangkai2018/personal-ai-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/Jiangkai2018/personal-ai-workbench/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-c2401c.svg)](LICENSE)

**[English](README.en.md)** | 中文

```
想法（3 秒捕获，不判断好坏）
  ↓ 一键转正（自动 AI 初评）
机会（5 维速评：值不值得做）
  ↓ 一键转正
目标（承诺 + 里程碑 + 进度）
  ↓ 拆解排期
任务（今天 / 本周 / 未来）
  ↓ 勾选完成
复盘（每晚日小结，自动推进目标进度）
  ↓ 反哺
第二天的执行依据
```

## 功能特性

### ✅ 现有功能

**闭环核心**

- ⚡ **想法捕获**：首页 3 秒快捷捕获 + 想法收件箱，成长 / 维护双轨道
- 🧭 **机会速评**：5 维打分（价值 / 可行 / 时间窗 / 匹配 / 风险）× 0–20 分 = 百分制，自动分档：≥80 转正候选、60–79 观察池、<60 归档，滑块实时重算
- 🤖 **AI 初评**：配好 Anthropic 兼容接口（如智谱 BigModel）后，新建机会「AI 预评」一键填分；想法转正瞬间自动初评 —— AI 只建议，你随时改
- 📊 **领域分析报告**：对机会发起异步深度分析（三段式：赛道市场 / 同行格局 / 切入策略，含真实账号数据画像），完成后专属报告页阅读
- 🎯 **目标管理**：CRUD + 里程碑 + 进度滑块（0–100）+ 复盘自动推进
- ✅ **任务分桶**：今天 / 本周 / 未来 / 归档四桶，支持挂靠目标与排期
- 🌙 **晚间复盘**：日小结 + 目标进度自动更新（每完成一个挂目标任务 +10%，封顶 100），按「日期 + 范围」幂等，复盘时间线可回溯
- ⚡ **直达转正**：想法→机会、机会→目标一键完成，无中间审批环节（[ADR-0003](docs/adr/0003-direct-promotion.md)）
- 👨‍👩‍👧 **个人 / 家庭双范围**：顶栏一键切换，家庭数据带标签隔离
- 💰 **财务模块（集成随手记）**：微信/支付宝账单上传 → AI 分类 → 预览确认 → 逐条写入随手记（进度条/断点续传/三层去重·远端为准）；月度消费报告（ECharts 图表 + AI 建议）；财务推演（收支档案 + 确定性复利曲线 + 里程碑 + AI 解读）

**鉴权与安全**

- 账号密码登录，JWT httpOnly Cookie 会话（7 天）
- 无自助注册：管理端 CLI 建号
- **家庭互证找回密码**：另一位家人验证后重置，留审计日志；双方都忘 → CLI 兜底

**数据与基础设施**

- **Markdown 即数据库**（ADR-0001）：每实体一个带 YAML frontmatter 的 `.md`，git 友好，可直接阅读编辑
- 统一错误处理（zod 校验 → 400 + 可读信息）
- 73 个单测（vitest + supertest）+ 25 个 e2e（Playwright，隔离数据目录）

**界面**

- 「纸墨」设计系统：暖纸底 + 墨色 + 朱砂点睛，思源宋体标题 + 等宽数字
- 响应式：手机底部 Dock → 桌面侧边导航轨，内容列随屏幕比例展宽
- 时尚滚动条、自定义滑杆 / 进度条 / 勾选动效、错峰入场动画

### 🚧 未来待接入

- **AI Agent 深化**
  - 复盘 Agent：替代 V0 确定性规则，生成更有洞察的日小结与进度建议
  - 初评增强：结合历史目标 / 复盘数据给出更懂你的打分依据
- **知识沉淀模块**：复盘结论沉淀为可检索的知识，反哺目标与机会决策
- **Git 自动同步**：数据变更后自动 `git add / commit`（可选 push），本地 bare repo 验证
- **PWA / 移动端安装**：主屏图标与离线壳

## 快速开始

```bash
# 环境要求：Node.js ≥ 22
npm install

# 建号（无自助注册）
npm run add-user -w server -- --username jk --password 你的密码 --name 张三 --family

# 一键启动 后端(5233) + 前端(5277)
npm run dev
```

浏览器访问 **http://localhost:5277**。

更多操作（密码找回、生产构建、备份）见 [docs/使用手册.md](docs/使用手册.md)。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 同时启动 server + web（开发模式） |
| `npm run build` | 构建 server + web |
| `npm run test` | 后端单测（vitest） |
| `npm run e2e` | Playwright 端到端（隔离数据目录，不碰真实数据） |
| `npm run add-user -w server -- --username x --password y [--name n] [--family]` | 建号 / 更新账号 |
| `npm run reset-password -w server -- --username x --password y` | 管理员重置密码（兜底） |

## 项目结构

```
personal-ai-workbench/
├── server/            # Express API + 领域逻辑 + 文件存储
│   └── src/
│       ├── api/       # 路由（auth/ideas/opportunities/goals/tasks/reviews/today）
│       ├── auth/      # JWT + bcrypt + 家庭互证
│       ├── cli/       # add-user / reset-password
│       ├── domain/    # 领域规则（5 维评分分档等）
│       └── storage/   # EntityStore / ReviewStore / UserStore（Markdown 文件）
├── web/               # React SPA（Vite，纯 CSS 设计系统）
│   └── src/pages/     # 今日 / 想法 / 机会 / 目标 / 任务 / 复盘 / 登录
├── e2e/               # Playwright 端到端（.tmp-data 隔离）
├── server/src/ai/     # AI 初评客户端（Anthropic 兼容接口）
├── data/              # ★ 你的全部数据（Markdown 文件，建议纳入 git）
└── docs/              # 文档（使用手册）
```

## 配置

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `PORT` | `3000` | 后端端口 |
| `WORKBENCH_DATA_DIR` | `<仓库根>/data` | 数据目录 |
| `WORKBENCH_JWT_SECRET` | `dev-secret-change-me` | JWT 密钥，对外部署务必修改 |
| `WORKBENCH_API` | `http://localhost:5233` | 前端 dev 代理目标 |
| `WORKBENCH_AI_API_KEY` | 空 | AI 初评密钥（Anthropic 兼容接口，如智谱 BigModel），见 `.env.example` |
| `WORKBENCH_AI_BASE_URL` / `WORKBENCH_AI_MODEL` | BigModel / `glm-5.3` | AI 接口地址与模型 |

## 设计原则

1. **AI 只建议，不做决定** —— AI 初评只填分数，转正等承诺动作由你亲手点击（[ADR-0003](docs/adr/0003-direct-promotion.md)）。
2. **一切皆文件** —— 无数据库、无缓存、无供应商锁定；备份 = 备份目录（[ADR-0001](docs/adr/0001-markdown-as-data-source.md)）。
3. **捕获零摩擦** —— 想法 3 秒记下，判断留给速评和复盘。
4. **个人规模优先** —— 文件遍历式存储在千级条目内完全够用，不为假想的规模提前设计。

架构决策记录（ADR）见 [docs/adr/](docs/adr/)。

## 安全

- 会话为 JWT httpOnly Cookie；密码 bcrypt 哈希存储。
- **对外部署前必须设置 `WORKBENCH_JWT_SECRET`**（用默认密钥启动时服务端会打印醒目警告）。
- 数据目录含个人隐私，仓库默认不跟踪 `data/` 下的运行数据。

## 许可

[MIT](LICENSE) © 2026 coder_jk

## 镜像

- GitHub（主）：https://github.com/Jiangkai2018/personal-ai-workbench
- Gitee（镜像）：https://gitee.com/coder_jk/personal-ai-workbench
