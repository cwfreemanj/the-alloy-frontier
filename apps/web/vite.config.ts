import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5178, strictPort: true },
  preview: { port: 4178, strictPort: true },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: (id: string) => (id.includes('node_modules/three') ? 'three' : undefined),
      },
    },
  },
});
