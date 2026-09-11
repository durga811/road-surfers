import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, open: false },
  build: {
    target: 'es2022',
    // three + GLTFLoader + skinning is ~550 kB minified (138 kB gzipped);
    // it is one vendor chunk by design, so the default warning is noise.
    chunkSizeWarningLimit: 620,
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'] },
      },
    },
  },
});
