/**
 * drizzle-kit 配置：从 schema.ts（唯一真相源）生成迁移文件到 drizzle/ 目录。
 * 用法：改 schema.ts 后执行 pnpm drizzle-kit generate，提交生成的迁移。
 */
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/main/services/store/schema.ts',
  out: './drizzle',
})