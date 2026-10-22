import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({ base: './', plugins: [react()], build: { target: 'es2022', outDir: '/tmp/dk-redesign-baseline-453b2db/capture-dist', sourcemap: false, cssCodeSplit: false, assetsInlineLimit: 10000000, rollupOptions: { output: { inlineDynamicImports: true } } } });
