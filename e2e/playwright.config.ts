import { defineConfig, devices } from '@playwright/test'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
// e2e 使用独立端口（3100/5174），避免复用到指向真实 data/ 的 dev server，
// 保证每次都是全新实例 + .tmp-data 隔离数据
const E2E_SERVER_PORT = 3100
const E2E_WEB_PORT = 5174
const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${E2E_WEB_PORT}`
// 浏览器通道：本机默认复用已装的 Chrome；CI 用 PLAYWRIGHT_CHANNEL=chromium 走 Playwright 自带浏览器
const CHANNEL = process.env.PLAYWRIGHT_CHANNEL || 'chrome'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1, // 共享同一 server + 数据目录，串行执行
  retries: 0,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'npm run dev -w server',
      url: `http://localhost:${E2E_SERVER_PORT}/api/ideas`,
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      cwd: root,
      env: {
        PORT: String(E2E_SERVER_PORT),
        WORKBENCH_DATA_DIR: path.join(import.meta.dirname, '.tmp-data'),
        // Agent 用例走真实模型：不设 WORKBENCH_AI_*，由 server 的 loadEnvFile 读仓库根 .env；
        // 如需离线回归，可临时在此加 WORKBENCH_AGENT_FAKE: '1' 强制确定性假模型。
      },
    },
    {
      command: `npm run dev -w web -- --port ${E2E_WEB_PORT} --strictPort`,
      url: `http://localhost:${E2E_WEB_PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 20_000,
      cwd: root,
      env: {
        WORKBENCH_API: `http://localhost:${E2E_SERVER_PORT}`,
      },
    },
  ],
  projects: [
    {
      name: 'mobile-chromium',
      use: {
        browserName: 'chromium',
        ...(CHANNEL ? { channel: CHANNEL } : {}),
        // 移动优先：390×844 视口 + 触屏仿真
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: devices['iPhone 13'].userAgent,
      },
    },
  ],
})
