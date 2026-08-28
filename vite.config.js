import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/nba-showdown-2k25/',
  test: {
    // .worktrees/ holds full checkouts (including their own scripts/cardgen
    // tests) for in-progress feature branches — exclude it so vitest's default
    // recursive discovery doesn't pick up and duplicate-run tests from inside
    // a worktree alongside the same tests in the main tree.
    exclude: ['**/node_modules/**', '**/dist/**', '.worktrees/**'],
  },
})
