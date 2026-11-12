import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';

/** The two files every first paint needs: the display face and the body face, latin subset only. */
const CRITICAL_FONTS = [/londrina-solid-latin-900-normal-.*\.woff2$/, /nunito-latin-wght-normal-.*\.woff2$/];

/**
 * Preloads the critical fonts in the built HTML. The files are content-hashed, so the names are only known once
 * the bundle exists; without a preload the browser finds them after it has parsed the CSS. Build only.
 */
function preloadFonts(): Plugin {
  return {
    name: 'preload-critical-fonts',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(_html, ctx) {
        const names = Object.keys(ctx.bundle ?? {});
        return CRITICAL_FONTS.flatMap(pattern => names.filter(name => pattern.test(name))).map(name => ({
          tag: 'link',
          attrs: { rel: 'preload', as: 'font', type: 'font/woff2', href: `/${name}`, crossorigin: '' },
          injectTo: 'head' as const,
        }));
      },
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), preloadFonts()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@the-rule/verifier-wasm'] },
  build: { target: 'es2023', sourcemap: true },
  server: { port: 5173, strictPort: true },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
