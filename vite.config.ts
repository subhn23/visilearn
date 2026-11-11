import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss()],
  // production build: JS (incl. Alpine) and CSS (Tailwind) are minified by default
  build: { outDir: 'dist', target: 'es2022', minify: 'esbuild', cssMinify: 'lightningcss' },
});
