# ADR-0007：Agent 页面采用「官方骨架 × 纸墨配色」，会话列表数据层保持自管

## 背景

任务书要求 AI 对话页参考 assistant-ui。M1 用该库的无头 primitives 自组了纸墨风格皮肤，观感与官网 ChatGPT 式成品差异大；而 M2 即将需要的工具卡片、消息操作栏、代码块打磨恰好是官方 shadcn 预设最成熟的部分。

## 决策（2026-08-27 对齐）

1. **皮肤层全量换为官方预设**：`shadcn init` 底座 + 拷入 Thread 消息流与 ThreadList 两组预设组件源码
2. **配色不跟随官网**：shadcn 的 CSS 变量（`--background/--primary/--radius…`）映射到纸墨 token —— 官方布局交互 × 工作台视觉语言
3. **数据管线一根手指不动**：会话列表继续自管 REST + `useChatRuntime({id, messages})` 注入回放；ThreadList 预设仅作视觉容器。理由：`RemoteThreadListAdapter` 的按线程历史绑定 assistant-cloud 内部机制，且现管线已实战修复 `__LOCALID__` 串线与 GLM `/v1` 路径两坑
4. **ReasoningFold 思考折叠保留自研**（思考中直播计时/正文出现自动收起回看），样式挂进新骨架
5. 排期为 **M1.5 独立切片**，先于 M2；六个 e2e `data-testid` 原名平移，测试文档零改动

## 备选备忘

- 整体照抄官网 shadcn 中性灰风：与全站纸墨设计语言割裂，否
- 只零散补细节件不引预设：凑不出整体品质且违背少造轮子原则，否
- 连数据层归队官方 RemoteThreadList：风险高收益仅为架构正统，否
