import { defineConfig } from 'astro/config'

const base = process.env.BASE_PATH || '/'

export default defineConfig({
  output: 'static',
  site: process.env.SITE_URL || 'http://localhost:4321',
  base,
  trailingSlash: 'always',
})
