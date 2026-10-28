// A DEPLOY THAT KEEPS MAIN IN STEP (2026-10-28): the steps, against a fake git.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { before, strip, after, changedBuildInputs, isBuildInput, botOnly, LIVE_BOT_FILES } from './deploySync.mjs';

/** A git that answers from a table and records every call. */
function fakeGit(answers = {}, { fail = [] } = {}) {
  const calls = [];
  const git = (...args) => {
    const k = args.join(' ');
    calls.push(k);
    if (fail.some(f => k.startsWith(f))) { const e = new Error(`git ${k} failed`); e.stderr = 'refused'; throw e; }
    return answers[k] ?? '';
  };
  return { git, calls };
}
const LOCAL = { CI: '' };
const quiet = () => {};

describe('what the build reads', () => {
  it('is src, public and card-data and the build files, never the Live faces or untracked files', () => {
    expect(isBuildInput('src/game/engine.js')).toBe(true);
    expect(isBuildInput('card-data/generated/cards.json')).toBe(true);
    expect(isBuildInput('package.json')).toBe(true);
    expect(isBuildInput('card-art/sets/2026-27/crops.json')).toBe(false);
    expect(isBuildInput('docs/plans/x.md')).toBe(false);
    expect(isBuildInput('public/cards/live/Jalen_Brunson.png')).toBe(false);
    expect(isBuildInput('public/cards/thumbs/live/Jalen_Brunson.webp')).toBe(false);
    const status = [' M card-art/sets/2026-27/crops.json', ' M src/game/run.js', '?? public/cards/team-rewards/X.png', 'R  src/a.js -> src/b.js'].join('\n');
    expect(changedBuildInputs(status)).toEqual(['src/game/run.js', 'src/b.js']);
    expect(botOnly(LIVE_BOT_FILES)).toBe(true);
    // The Live Series view's night by night (2026-10-28) is the bot's too.
    expect(botOnly(['card-data/generated/live-history.json'])).toBe(true);
    expect(botOnly(['card-data/generated/cards-live.json', 'src/x.js'])).toBe(false);
  });
});

describe('before the deploy', () => {
  it('steps aside in the nightly job', () => {
    const { git, calls } = fakeGit();
    expect(before({ git, log: quiet, env: { CI: 'true' } })).toBe(0);
    expect(calls).toEqual([]);
  });

  it('stops on uncommitted changes the build would carry, and puts back the bot\'s files', () => {
    const { git, calls } = fakeGit({ 'status --porcelain': ' M card-data/generated/cards-live.json\n M src/game/engine.js\n M card-art/sets/2026-27/crops.json' });
    const lines = [];
    expect(before({ git, log: l => lines.push(l), env: LOCAL })).toBe(1);
    expect(calls).toContain('checkout -- card-data/generated/cards-live.json');
    expect(lines.join('\n')).toContain('src/game/engine.js');
    expect(lines.join('\n')).not.toContain('crops.json');
    expect(calls.some(c => c.startsWith('fetch'))).toBe(false);
  });

  it('merges main when its new commits are only the bot\'s numbers', () => {
    const { git, calls } = fakeGit({
      'rev-list HEAD..origin/main': 'aaa\nbbb',
      'diff --name-only HEAD...origin/main': LIVE_BOT_FILES.join('\n'),
      'rev-parse --short HEAD': 'abc1234',
    });
    expect(before({ git, log: quiet, env: LOCAL })).toBe(0);
    expect(calls).toContain('merge --no-edit origin/main');
  });

  it('stops when main has anything else, and backs out a merge that fails', () => {
    const other = fakeGit({ 'rev-list HEAD..origin/main': 'aaa', 'diff --name-only HEAD...origin/main': 'src/game/engine.js' });
    expect(before({ git: other.git, log: quiet, env: LOCAL })).toBe(1);
    expect(other.calls).not.toContain('merge --no-edit origin/main');
    const broken = fakeGit({ 'rev-list HEAD..origin/main': 'aaa', 'diff --name-only HEAD...origin/main': LIVE_BOT_FILES[0] }, { fail: ['merge --no-edit'] });
    expect(before({ git: broken.git, log: quiet, env: LOCAL })).toBe(1);
    expect(broken.calls).toContain('merge --abort');
  });

  it('goes straight on when main has nothing new', () => {
    const { git, calls } = fakeGit({ 'rev-parse --short HEAD': 'abc1234' });
    expect(before({ git, log: quiet, env: LOCAL })).toBe(0);
    expect(calls.some(c => c.startsWith('merge'))).toBe(false);
  });
});

describe('the build', () => {
  it('leaves the Live faces to the nightly job, except in the nightly job', () => {
    const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'dist-'));
    const make = () => {
      for (const d of ['cards/live', 'cards/thumbs/live', 'cards/2026-27']) {
        fs.mkdirSync(path.join(dist, d), { recursive: true });
        fs.writeFileSync(path.join(dist, d, 'x.png'), 'x');
      }
    };
    make();
    strip({ dist, log: quiet, env: { CI: 'true' } });
    expect(fs.existsSync(path.join(dist, 'cards/live/x.png'))).toBe(true);
    strip({ dist, log: quiet, env: LOCAL });
    expect(fs.existsSync(path.join(dist, 'cards/live'))).toBe(false);
    expect(fs.existsSync(path.join(dist, 'cards/thumbs/live'))).toBe(false);
    expect(fs.existsSync(path.join(dist, 'cards/2026-27/x.png'))).toBe(true);
    fs.rmSync(dist, { recursive: true, force: true });
  });
});

describe('after the deploy', () => {
  it('pushes the branch and moves main to what was deployed', () => {
    const { git, calls } = fakeGit({ 'rev-parse --short HEAD': 'abc1234' });
    expect(after({ git, log: quiet, env: LOCAL })).toBe(0);
    expect(calls).toContain('push --quiet origin HEAD');
    expect(calls).toContain('push --quiet origin HEAD:refs/heads/main');
  });

  it('says so when main cannot be moved, and does nothing in the nightly job', () => {
    const lines = [];
    const refused = fakeGit({ 'rev-parse --short HEAD': 'abc1234' }, { fail: ['push --quiet origin HEAD:refs/heads/main'] });
    expect(after({ git: refused.git, log: l => lines.push(l), env: LOCAL })).toBe(1);
    expect(lines.join('\n')).toContain('main could not be moved');
    const ci = fakeGit();
    expect(after({ git: ci.git, log: quiet, env: { GITHUB_ACTIONS: 'true' } })).toBe(0);
    expect(ci.calls).toEqual([]);
  });
});
