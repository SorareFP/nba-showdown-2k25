// cards-free-agents.json, read and written in one place. No card-pipeline
// imports on purpose: the Card Studio's dev-server plugin writes through this
// too, and the Vite config process should not have to load the card sets.
import fs from 'node:fs';
import path from 'node:path';

export const freeAgentsPath = root => path.join(root, 'card-data', 'generated', 'cards-free-agents.json');

export function readFreeAgents(root) {
  const file = freeAgentsPath(root);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { set: 'free-agents', cards: [] };
}

/** The file with `card` in it: a rebuild of the same request replaces the old card. */
export function withFreeAgent(file, card) {
  const others = (file.cards ?? []).filter(c => !(card.requestId && c.requestId === card.requestId));
  return { ...file, set: 'free-agents', cards: [...others, card] };
}

export function saveFreeAgent(root, card) {
  const next = withFreeAgent(readFreeAgents(root), card);
  fs.writeFileSync(freeAgentsPath(root), `${JSON.stringify(next, null, 1)}\n`);
  return next;
}
