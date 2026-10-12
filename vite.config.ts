import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Desktop local: el tamaño del bundle no viaja por red, no hace falta partirlo.
  build: { outDir: 'dist', emptyOutDir: true, chunkSizeWarningLimit: 3000 },
});
