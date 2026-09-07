import { statSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { studioServerPlugin } from './scripts/studio/studioServerPlugin.js'

// Replaces `__ENGINE_STAMP__` in src/game/engine.js with the file's own
// last-modified time (see ENGINE_STAMP there). A transform rather than
// `define` so a dev server started days ago still stamps the engine it is
// actually serving.
function engineStampPlugin() {
  return {
    name: 'engine-stamp',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith('/src/game/engine.js')) return null;
      const stamp = statSync(id).mtime.toISOString().slice(0, 16).replace('T', ' ');
      return { code: code.replace('__ENGINE_STAMP__', JSON.stringify(stamp)), map: null };
    },
  };
}

export default defineConfig({
  // studioServerPlugin is `apply: 'serve'` — it adds the Card Studio's file
  // persistence routes to the dev server and is inert during `vite build`.
  plugins: [react(), studioServerPlugin(), engineStampPlugin()],
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
