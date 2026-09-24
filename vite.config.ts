import { defineConfig } from 'vitest/config';

// Relative base so the production build can be opened from any static host or sub-path.
export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
