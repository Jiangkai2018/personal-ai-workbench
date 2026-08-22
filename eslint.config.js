// ESLint 扁平配置：覆盖 web + server（e2e 由 Playwright 自管，不在此列）
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'e2e/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // 下划线前缀 = 有意忽略（Express 错误处理器的 _req/_next 等）
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    languageOptions: { globals: globals.browser },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // 本项目统一用「挂载时拉取」的简单模式（无 react-query 等外部状态库），
      // v7 新规则对这一模式一律报错，关闭之
      'react-hooks/set-state-in-effect': 'off',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    files: ['server/src/**/*.ts', 'server/test/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
)
