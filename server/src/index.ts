import path from 'node:path'
import { createApp } from './api/app'

// 开发便利：加载仓库根 .env（不覆盖已设置的变量；e2e 用空串屏蔽 AI 配置）
try {
  process.loadEnvFile(path.resolve(import.meta.dirname, '..', '..', '.env'))
} catch {
  // 没有 .env 时静默跳过
}

// 数据目录默认指向仓库根 data/（可用 WORKBENCH_DATA_DIR 覆盖）
// 用脚本相对路径解析，与启动时 cwd 无关（npm workspace / e2e / CLI 都能用对）
const dataDir =
  process.env.WORKBENCH_DATA_DIR ||
  path.resolve(import.meta.dirname, '..', '..', 'data')
// 永久约定：后端 5233 / 前端 5277（可用 PORT 覆盖）
const port = Number(process.env.PORT || 5233)

const app = createApp({ dataDir })
app.listen(port, () => {
  console.log(`个人AI工作台 server → http://localhost:${port}  (data: ${dataDir})`)
})
