import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { studioServerPlugin } from './scripts/studio/studioServerPlugin.js'

export default defineConfig({
  // studioServerPlugin is `apply: 'serve'` — it adds the Card Studio's file
  // persistence routes to the dev server and is inert during `vite build`.
  plugins: [react(), studioServerPlugin()],
  base: '/nba-showdown-2k25/',
  // Serve project-root files (card-art/ lives outside public/ because photos
  // are working files, not shipped assets — only the exported PNGs ship).
  server: { fs: { allow: ['.'] } },
  test: {
    // .worktrees/ holds full checkouts (including their own scripts/cardgen
    // tests) for in-progress feature branches — exclude it so vitest's default
    // recursive discovery doesn't pick up and duplicate-run tests from inside
    // a worktree alongside the same tests in the main tree.
    exclude: ['**/node_modules/**', '**/dist/**', '.worktrees/**'],
  },
})
