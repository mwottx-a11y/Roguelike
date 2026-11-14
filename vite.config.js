import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The dev/build entry is game.html. (index.html at the repo root is only a redirect for GitHub Pages.)
// `npm run build`            -> docs/        (committed; this is what GitHub Pages serves)
// `SINGLE=1 npx vite build`  -> dist-single/ (one self-contained game.html)
export default defineConfig({
  base: './',
  plugins: process.env.SINGLE ? [viteSingleFile()] : [],
  server: { open: '/game.html' },
  build: {
    outDir: process.env.SINGLE ? 'dist-single' : 'docs',
    emptyOutDir: true,
    rollupOptions: { input: 'game.html' },
    chunkSizeWarningLimit: 4000,
  },
});
