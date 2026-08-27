import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// e2e / 手动冒烟通过 WORKBENCH_API 注入后端地址（dev 默认不设）。
// 这类实例与本机 dev 常驻 vite 并行：必须各自持有 deps 预构建缓存，
// 否则共享 node_modules/.vite 会互相判「Outdated Optimize Dep」（504）导致白屏。
const isIsolated = Boolean(process.env.WORKBENCH_API)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  cacheDir: isIsolated ? 'node_modules/.vite-isolated' : 'node_modules/.vite',
  // 预热重型依赖：isolated 实例首跑在监听前完成 optimize，避免首屏按需发现引发的 504/重载竞态
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      '@ai-sdk/react',
      '@assistant-ui/react',
      '@assistant-ui/ai-sdk',
      '@assistant-ui/react-markdown',
      'remark-gfm',
    ],
  },
  server: {
    // 永久绑定 5277：被占用时直接报错退出（strictPort），绝不静默换端口
    port: 5277,
    strictPort: true,
    proxy: {
      '/api': {
        target: process.env.WORKBENCH_API || 'http://localhost:5233',
        changeOrigin: true,
      },
    },
  },
})
