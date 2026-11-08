import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@the-rule/verifier-wasm'] },
  build: { target: 'es2023', sourcemap: true },
  server: { port: 5173, strictPort: true },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
