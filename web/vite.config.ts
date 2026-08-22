import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 开发时前端走 Vite，/api 代理到后端 Express
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.WORKBENCH_API || 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
