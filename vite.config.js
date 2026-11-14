import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `vite build` -> dist/ (normal static site)
// `SINGLE=1 vite build` -> one self-contained index.html in dist-single/
export default defineConfig({
  base: './',
  plugins: process.env.SINGLE ? [viteSingleFile()] : [],
  build: {
    outDir: process.env.SINGLE ? 'dist-single' : 'dist',
    chunkSizeWarningLimit: 4000,
  },
});
