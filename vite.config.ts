import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// base './': relative asset and data paths, so the same dist/ works on Vercel, on a
// GitHub Pages sub-path (/NASA-Hackathon-2026/) and copied to any folder for the offline demo.
export default defineConfig({
  base: './',
  plugins: [react()],
})
