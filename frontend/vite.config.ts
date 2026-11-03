/// <reference types="vitest/config" />
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const here = path.dirname(fileURLToPath(import.meta.url))
const dep = (name: string) => path.resolve(here, 'node_modules', name)

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(here, 'src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // The parity test imports client/src/lib/canonical.ts, which lives outside
    // this package and has no node_modules of its own. Point its two bare
    // imports at this package's copies so the test runs from a clean clone
    // without `npm install` in client/.
    alias: {
      'json-stable-stringify': dep('json-stable-stringify'),
      bs58: dep('bs58'),
    },
  },
})
