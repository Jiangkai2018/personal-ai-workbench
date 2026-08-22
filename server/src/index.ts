import path from 'node:path'
import { createApp } from './api/app'

// 数据目录默认指向仓库根 data/（可用 WORKBENCH_DATA_DIR 覆盖）
// 用脚本相对路径解析，与启动时 cwd 无关（npm workspace / e2e / CLI 都能用对）
const dataDir =
  process.env.WORKBENCH_DATA_DIR ||
  path.resolve(import.meta.dirname, '..', '..', 'data')
const port = Number(process.env.PORT || 3000)

const app = createApp({ dataDir })
app.listen(port, () => {
  console.log(`个人AI工作台 server → http://localhost:${port}  (data: ${dataDir})`)
})
