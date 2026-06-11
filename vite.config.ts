import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
// On GitHub Pages the site is served from /liminal/, so use that base for the
// production build while keeping the dev server at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/liminal/' : '/',
  plugins: [react()],
}))
