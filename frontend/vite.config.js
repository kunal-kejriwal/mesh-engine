import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, existsSync } from 'fs'

// Dev-mode: copy root .md files into public/docs/ so the dev server can serve them.
// In production (Docker build), the Dockerfile copies them directly.
try {
  const root = resolve(__dirname, '..')
  const dest = resolve(__dirname, 'public', 'docs')
  if (!existsSync(dest)) mkdirSync(dest, { recursive: true })
  for (const f of [
    'API_Documentation.md',
    'About_MeshEngine.md',
    'GIT_SETUP.md',
    'LOCAL_SETUP.md',
    'RUN_AND_TEST.md',
  ]) {
    copyFileSync(resolve(root, f), resolve(dest, f))
  }
} catch { /* running inside Docker where root .md files are already in public/docs */ }

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/ws': {
        target: 'ws://localhost:8000',
        ws: true,
      },
    },
  },
})
