import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs also work when the build is hosted below a subdirectory.
  base: './',
  build: {
    sourcemap: true,
  },
});
