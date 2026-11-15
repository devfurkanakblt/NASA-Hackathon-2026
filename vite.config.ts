/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// base './': relative asset and data paths, so the same dist/ works on Vercel, on a
// GitHub Pages sub-path (/NASA-Hackathon-2026/) and copied to any folder for the offline demo.
export default defineConfig({
  base: './',
  plugins: [react()],
  // Library code in its own long-cached chunks, each under 500 kB, so the app's own code stays
  // small and a code change does not make visitors download React or three.js again.
  build: {
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\/](react|react-dom|scheduler)[\/]/ },
            { name: 'motion', test: /node_modules[\/](motion|motion-dom|motion-utils|framer-motion)[\/]/ },
            { name: 'gsap', test: /node_modules[\/]gsap[\/]/ },
            // three.js alone is ~740 kB: its core and its renderer/extras load as two chunks.
            { name: 'three-core', test: /node_modules[\/]three[\/]build[\/]three\.core/, priority: 3 },
            { name: 'three', test: /node_modules[\/]three[\/]/, priority: 2 },
            { name: 'r3f', test: /node_modules[\/](@react-three|its-fine|zustand|suspend-react|react-use-measure|use-sync-external-store)[\/]/ },
          ],
        },
      },
    },
  },
  // Data tests read the real per-site files of the 32-place catalogue; with the whole suite in
  // parallel some take just over Vitest's 5 s default, so allow more before calling it a failure.
  test: { testTimeout: 20_000 },
})
