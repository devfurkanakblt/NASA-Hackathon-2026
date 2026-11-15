/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// base './': relative asset and data paths, so the same dist/ works on Vercel, on a
// GitHub Pages sub-path (/NASA-Hackathon-2026/) and copied to any folder for the offline demo.
export default defineConfig({
  base: './',
  plugins: [react()],
  // Data tests read the real per-site files of the 32-place catalogue; with the whole suite in
  // parallel some take just over Vitest's 5 s default, so allow more before calling it a failure.
  test: { testTimeout: 20_000 },
})
