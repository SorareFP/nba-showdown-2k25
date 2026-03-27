# Card Viewer System — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a click-to-expand card viewer (lightbox) across all tabs, plus rework the hand panel to use confirm-before-play with a separate view icon.

**Architecture:** A single `<CardLightbox>` modal component rendered at the App level, controlled via a context provider. Any component can open it by calling `openLightbox({type, data})`. The hand panel gets a staged-card state with confirm/cancel flow.

**Tech Stack:** React 18, CSS Modules, existing Vite setup. No new dependencies.

---

### Task 1: Create CardLightbox component and context

**Files:**
- Create: `src/components/CardLightbox.jsx`
- Create: `src/components/CardLightbox.module.css`
- Modify: `src/App.jsx`

**Step 1: Create the context + provider + modal component**

Create `src/components/CardLightbox.jsx`:

```jsx
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getPlayerImageUrl, getStratImagePath } from '../game/cardImages.js';
import styles from './CardLightbox.module.css';

const LightboxCtx = createContext(null);

export function useLightbox() {
  return useContext(LightboxCtx);
}

export function LightboxProvider({ children }) {
  const [item, setItem] = useState(null);      // { type:'player'|'strat', data:{...} }
  const [fullRes, setFullRes] = useState(false); // magnifying-glass mode

  const open = useCallback((type, data) => { setItem({ type, data }); setFullRes(false); }, []);
  const close = useCallback(() => { setItem(null); setFullRes(false); }, []);

  useEffect(() => {
    if (!item) return;
    const onKey = e => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [item, close]);

  return (
    <LightboxCtx.Provider value={{ open, close }}>
      {children}
      {item && (fullRes
        ? <FullResOverlay item={item} onClose={() => setFullRes(false)} />
        : <LightboxModal item={item} onClose={close} onFullRes={() => setFullRes(true)} />
      )}
    </LightboxCtx.Provider>
  );
}

function LightboxModal({ item, onClose, onFullRes }) {
  const { type, data } = item;
  const imgSrc = type === 'player'
    ? getPlayerImageUrl(data.id)
    : getStratImagePath(data.id);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={e => e.stopPropagation()}>
        <button className={styles.closeBtn} onClick={onClose}>×</button>

        <div className={styles.content}>
          {/* Left: image */}
          <div className={styles.imgSide}>
            {imgSrc
              ? <img src={imgSrc} alt={data.name || data.n} className={styles.img}
                  onError={e => { e.target.style.display = 'none'; }} />
              : <div className={styles.placeholder}>{data.name || data.n}</div>}
            {imgSrc && (
              <button className={styles.zoomBtn} onClick={onFullRes} title="Full resolution">
                🔍
              </button>
            )}
          </div>

          {/* Right: stats */}
          <div className={styles.statsSide}>
            {type === 'player' ? <PlayerStats card={data} /> : <StratStats card={data} />}
          </div>
        </div>
      </div>
    </div>
  );
}

function FullResOverlay({ item, onClose }) {
  const { type, data } = item;
  const imgSrc = type === 'player'
    ? getPlayerImageUrl(data.id)
    : getStratImagePath(data.id);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <img src={imgSrc} alt={data.name || data.n} className={styles.fullResImg}
        onClick={e => e.stopPropagation()} />
      <button className={styles.closeBtnFull} onClick={onClose}>×</button>
    </div>
  );
}

function PlayerStats({ card }) {
  const boosts = [
    card.threePtBoost !== 0 && `3PT ${card.threePtBoost > 0 ? '+' : ''}${card.threePtBoost}`,
    card.paintBoost !== 0 && `Paint ${card.paintBoost > 0 ? '+' : ''}${card.paintBoost}`,
    card.defBoost !== 0 && `Def ${card.defBoost > 0 ? '+' : ''}${card.defBoost}`,
  ].filter(Boolean);

  return (
    <>
      <h2 className={styles.lbName}>{card.name}</h2>
      <div className={styles.lbTeam}>{card.team === 'RTR' ? 'Retro' : card.team} · ${card.salary}</div>
      <div className={styles.lbStats}>
        <div className={styles.lbStat}><span>SPD</span><strong>{card.speed}</strong></div>
        <div className={styles.lbStat}><span>PWR</span><strong>{card.power}</strong></div>
        <div className={styles.lbStat}><span>LINE</span><strong>{card.shotLine}</strong></div>
      </div>
      {boosts.length > 0 && <div className={styles.lbBoosts}>{boosts.join(' · ')}</div>}
      <div className={styles.lbChart}>
        <div className={styles.lbChartHeader}>Scoring Chart</div>
        {card.chart.map((t, i) => (
          <div key={i} className={styles.lbChartRow}>
            <span className={styles.lbRange}>{t.hi >= 99 ? `${t.lo}+` : t.lo === t.hi ? t.lo : `${t.lo}–${t.hi}`}</span>
            <span>{t.pts}pts {t.reb}reb {t.ast}ast</span>
          </div>
        ))}
      </div>
    </>
  );
}

const PHASE_LABELS = {
  matchup: 'Matchup Phase', pre_roll: 'Pre-Roll',
  scoring: 'Scoring Phase', post_roll: 'Post-Roll',
  reaction: 'Reaction',
};

function StratStats({ card }) {
  return (
    <>
      <h2 className={styles.lbName}>{card.name}</h2>
      <div className={styles.lbTags}>
        <span className={card.side === 'off' ? styles.lbOff : styles.lbDef}>
          {card.side === 'off' ? 'Offense' : 'Defense'}
        </span>
        <span className={styles.lbPhase}>{PHASE_LABELS[card.phase] || card.phase}</span>
        {card.locked && <span className={styles.lbLock}>Uncancelable</span>}
        <span className={styles.lbCopies}>×{card.copies}</span>
      </div>
      <p className={styles.lbDesc}>{card.desc}</p>
    </>
  );
}
```

**Step 2: Create the CSS module**

Create `src/components/CardLightbox.module.css`:

```css
.backdrop {
  position: fixed; inset: 0; z-index: 300;
  background: rgba(0,0,0,0.75);
  display: flex; align-items: center; justify-content: center;
  padding: 1.5rem;
}

.modal {
  background: #0F1E35;
  border: 1px solid rgba(255,255,255,0.15);
  border-radius: 16px;
  max-width: 700px; width: 100%;
  max-height: 90vh; overflow-y: auto;
  box-shadow: 0 12px 60px rgba(0,0,0,0.7);
  position: relative;
}

.closeBtn {
  position: absolute; top: 10px; right: 14px;
  background: none; border: none; color: #94A3B8;
  font-size: 24px; cursor: pointer; z-index: 2;
  line-height: 1; padding: 4px 8px; border-radius: 6px;
}
.closeBtn:hover { color: #F1F5F9; background: rgba(255,255,255,0.1); }

.content { display: flex; gap: 0; }
@media (max-width: 600px) { .content { flex-direction: column; } }

.imgSide {
  flex: 0 0 55%; position: relative;
  background: rgba(0,0,0,0.3);
  border-radius: 16px 0 0 16px;
  overflow: hidden;
  display: flex; align-items: center; justify-content: center;
  min-height: 300px;
}
@media (max-width: 600px) { .imgSide { border-radius: 16px 16px 0 0; min-height: 200px; } }

.img { width: 100%; height: 100%; object-fit: cover; display: block; }

.placeholder {
  padding: 2rem; text-align: center;
  color: #475569; font-size: 16px; font-style: italic;
}

.zoomBtn {
  position: absolute; bottom: 10px; right: 10px;
  background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.2);
  color: #F1F5F9; font-size: 18px;
  width: 36px; height: 36px; border-radius: 8px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
}
.zoomBtn:hover { background: rgba(0,0,0,0.8); }

.statsSide { flex: 1; padding: 24px 20px; }

.lbName { font-size: 20px; font-weight: 700; color: #F1F5F9; margin: 0 0 4px; }
.lbTeam { font-size: 13px; color: #94A3B8; margin-bottom: 16px; }

.lbStats { display: flex; gap: 8px; margin-bottom: 14px; }
.lbStat {
  flex: 1; text-align: center;
  background: rgba(255,255,255,0.06); border-radius: 8px; padding: 8px 4px;
}
.lbStat span { display: block; font-size: 9px; color: #64748B; text-transform: uppercase; letter-spacing: .06em; }
.lbStat strong { display: block; font-size: 22px; font-weight: 800; color: #E2E8F0; }

.lbBoosts { font-size: 12px; color: #93C5FD; margin-bottom: 14px; }

.lbChart { border-top: 1px solid rgba(255,255,255,0.08); padding-top: 12px; }
.lbChartHeader { font-size: 11px; font-weight: 700; color: #64748B; text-transform: uppercase; letter-spacing: .06em; margin-bottom: 6px; }
.lbChartRow { display: flex; justify-content: space-between; font-size: 13px; color: #94A3B8; padding: 3px 0; }
.lbRange { font-weight: 600; color: #E2E8F0; }

.lbTags { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.lbOff { font-size: 11px; padding: 3px 10px; border-radius: 999px; font-weight: 600; background: rgba(234,88,12,0.2); color: #FB923C; }
.lbDef { font-size: 11px; padding: 3px 10px; border-radius: 999px; font-weight: 600; background: rgba(59,130,246,0.2); color: #93C5FD; }
.lbPhase { font-size: 11px; padding: 3px 10px; border-radius: 999px; background: rgba(255,255,255,0.08); color: #94A3B8; }
.lbLock { font-size: 11px; padding: 3px 10px; border-radius: 999px; background: rgba(245,158,11,0.2); color: #FCD34D; }
.lbCopies { font-size: 11px; color: #64748B; }

.lbDesc { font-size: 14px; color: #CBD5E1; line-height: 1.6; }

/* Full-res overlay */
.fullResImg {
  max-width: 95vw; max-height: 95vh;
  object-fit: contain; border-radius: 8px;
  box-shadow: 0 8px 40px rgba(0,0,0,0.5);
}
.closeBtnFull {
  position: fixed; top: 16px; right: 20px;
  background: rgba(0,0,0,0.6); border: 1px solid rgba(255,255,255,0.2);
  color: #F1F5F9; font-size: 24px;
  width: 40px; height: 40px; border-radius: 10px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  z-index: 301;
}
```

**Step 3: Wire LightboxProvider into App.jsx**

Modify `src/App.jsx`: wrap the entire app content in `<LightboxProvider>`.

```jsx
// Add import at top:
import { LightboxProvider } from './components/CardLightbox.jsx';

// Wrap return JSX:
return (
  <LightboxProvider>
    <div className={styles.app}>
      {/* ...existing content unchanged... */}
    </div>
  </LightboxProvider>
);
```

**Step 4: Verify build**

Run: `npm run build`
Expected: clean build, no errors.

**Step 5: Commit**

```bash
git add src/components/CardLightbox.jsx src/components/CardLightbox.module.css src/App.jsx
git commit -m "feat: add CardLightbox component and context provider"
```

---

### Task 2: Wire lightbox into Cards Tab and Strats Tab

**Files:**
- Modify: `src/components/CardsTab.jsx`
- Modify: `src/components/PlayerCard.jsx`
- Modify: `src/components/PlayerCard.module.css`
- Modify: `src/components/StratsTab.jsx`
- Modify: `src/components/StratsTab.module.css`

**Step 1: Make PlayerCard clickable in Cards Tab**

Modify `src/components/PlayerCard.jsx` — accept an `onClick` prop and make the card clickable:

```jsx
// Change the component signature:
export default function PlayerCard({ card, compact = false, actions, highlighted = false, onClick }) {

// Add onClick + cursor style to the root div:
<div
  className={`${styles.card} ${compact ? styles.compact : ''} ${highlighted ? styles.highlighted : ''}`}
  onClick={onClick}
  style={onClick ? { cursor: 'pointer' } : undefined}
>
```

**Step 2: Wire CardsTab to open lightbox on click**

Modify `src/components/CardsTab.jsx`:

```jsx
// Add import:
import { useLightbox } from './CardLightbox.jsx';

// Inside CardsTab component:
const { open } = useLightbox();

// Update the grid rendering:
{filtered.map(card => (
  <PlayerCard key={card.id} card={card} onClick={() => open('player', card)} />
))}
```

**Step 3: Wire StratsTab to open lightbox on click**

Modify `src/components/StratsTab.jsx` — add `useLightbox` and `onClick` to each card div:

```jsx
// Add import:
import { useLightbox } from './CardLightbox.jsx';

// Inside Group component, accept and use lightbox:
function Group({ title, cards, col }) {
  const { open } = useLightbox();
  // ...
  // Add onClick and cursor to each card div:
  <div key={s.id} className={styles.card} style={{ borderLeftColor: s.color, cursor: 'pointer' }}
    onClick={() => open('strat', s)}>
```

**Step 4: Add cursor:pointer to StratsTab card CSS**

Modify `src/components/StratsTab.module.css` — add to `.card`:

```css
.card {
  /* ...existing... */
  cursor: pointer;
  transition: border-color 0.15s;
}
.card:hover { border-color: rgba(255,255,255,0.25); }
```

**Step 5: Verify build and test**

Run: `npm run build`
Test: open dev server, click a player card in Cards tab → lightbox opens. Click a strat card in Strats tab → lightbox opens. Press Escape → closes. Click magnifying glass → full res.

**Step 6: Commit**

```bash
git add src/components/CardsTab.jsx src/components/PlayerCard.jsx src/components/StratsTab.jsx src/components/StratsTab.module.css
git commit -m "feat: wire lightbox into Cards and Strategy Cards tabs"
```

---

### Task 3: Wire lightbox into Team Builder

**Files:**
- Modify: `src/components/TeamBuilderTab.jsx`

**Step 1: Add lightbox to player pool and roster**

Modify `src/components/TeamBuilderTab.jsx`:

```jsx
// Add import:
import { useLightbox } from './CardLightbox.jsx';

// Inside TeamBuilderTab component:
const { open } = useLightbox();

// In the pool rendering, wrap PlayerCard with onClick:
{pool.map(card => (
  <PlayerCard key={card.id} card={card} onClick={() => open('player', card)} actions={...} />
))}
```

For RosterPanel, add an `onView` prop and make player names clickable:

```jsx
// In RosterPanel, accept onView prop:
function RosterPanel({ name, color, sal, roster, onRemove, onRandomize, onView }) {
  // ...
  // Make roster item name clickable:
  <div className={styles.rosterName}
    style={{ cursor: 'pointer', textDecoration: 'underline dotted' }}
    onClick={() => onView(c)}>{c.name}</div>
```

Pass `onView` from TeamBuilderTab:

```jsx
<RosterPanel ... onView={card => open('player', card)} />
```

**Step 2: Verify and commit**

Run: `npm run build`

```bash
git add src/components/TeamBuilderTab.jsx
git commit -m "feat: wire lightbox into Team Builder tab"
```

---

### Task 4: Rework Hand Panel — staged card + confirm + eye icon

**Files:**
- Modify: `src/components/game/CourtBoard.jsx:486-533` (HandPanel function)
- Modify: `src/components/game/CourtBoard.module.css:107-119` (hand styles)

**Step 1: Add lightbox import and staged state to HandPanel**

Modify the HandPanel function in `src/components/game/CourtBoard.jsx`:

```jsx
// Add import at top of file:
import { useLightbox } from '../CardLightbox.jsx';

// Replace the HandPanel function (line 486-533):
function HandPanel({ game, teamKey, onExecCard }) {
  const [staged, setStaged] = useState(null); // index of staged card
  const { open } = useLightbox();
  const t = getTeam(game, teamKey);
  const col = teamKey === 'A' ? 'var(--orange)' : 'var(--blue)';
  const { phase, scoringTurn, scoringPasses, matchupTurn } = game;
  const rollingOpen = scoringPasses >= 99;
  const isActive = phase === 'matchup_strats' ? matchupTurn === teamKey : (rollingOpen || scoringTurn === teamKey);
  const playablePhases = phase === 'matchup_strats' ? ['matchup'] : (isActive ? ['scoring', 'pre_roll', 'post_roll'] : []);

  return (
    <div className={`${styles.handPanel} ${teamKey === 'A' ? styles.handL : styles.handR}`}>
      <div className={styles.handTitle} style={{ color: col }}>
        Team {teamKey} <span className={styles.handCount}>{t.hand.length}</span>
      </div>
      <div className={styles.handList}>
        {t.hand.length === 0 && <div className={styles.handEmpty}>No cards</div>}
        {t.hand.map((id, hi) => {
          const s = getStrat(id); if (!s) return null;
          const isReaction = s.phase === 'reaction';
          const play = canPlayCard(game, teamKey, id);
          const canClick = play.canPlay && (isReaction || playablePhases.includes(s.phase));
          const sImg = getStratImagePath(id);
          const isStaged = staged === hi;

          return (
            <div key={`${id}-${hi}`}
              className={`${styles.hcard} ${!canClick ? styles.hdim : ''} ${isReaction && play.canPlay ? styles.hreact : ''} ${sImg ? styles.hcardHasImg : ''} ${isStaged ? styles.hcardStaged : ''}`}
              style={{ borderLeftColor: s.color }}>

              {/* Icon bar */}
              <div className={styles.hcardIcons}>
                <button className={styles.hcardIconBtn} onClick={() => open('strat', s)} title="View card">
                  👁
                </button>
                {canClick && !isStaged && (
                  <button className={styles.hcardIconBtn} onClick={() => setStaged(hi)} title="Play card"
                    style={{ color: '#4ADE80' }}>
                    ▶
                  </button>
                )}
              </div>

              {sImg
                ? <>
                    <img src={sImg} alt={s.name} className={styles.hcardImgEl} onError={e => { e.target.style.display = 'none'; }} />
                    <div className={styles.hcardOverlay}>
                      <div className={styles.hname}>{s.name}</div>
                      {!canClick && <div style={{ fontSize: 9, color: '#F87171', marginTop: 2, padding: '0 4px' }}>
                        {play.reason}
                      </div>}
                    </div>
                  </>
                : <>
                    <div className={styles.hphase}>{s.side === 'off' ? '⚡' : '🛡'} {s.phase.replace('_', ' ')}{s.locked ? ' 🔒' : ''}</div>
                    <div className={styles.hname}>{s.name}</div>
                    <div className={styles.hdesc}>{canClick ? s.desc.substring(0, 65) + '…' : play.reason}</div>
                  </>
              }

              {/* Confirm/cancel bar for staged card */}
              {isStaged && (
                <div className={styles.hcardConfirm}>
                  <button className={styles.confirmBtn} style={{ background: s.color }}
                    onClick={() => { setStaged(null); onExecCard(teamKey, id, {}); }}>
                    Confirm Play
                  </button>
                  <button className={styles.cancelBtn} onClick={() => setStaged(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**Step 2: Add new CSS classes**

Append to `src/components/game/CourtBoard.module.css`:

```css
/* ── Hand card icons ── */
.hcardIcons {
  position: absolute; top: 4px; right: 4px;
  display: flex; gap: 2px; z-index: 3;
}
.hcardIconBtn {
  background: rgba(0,0,0,0.5); border: 1px solid rgba(255,255,255,0.15);
  color: #E2E8F0; font-size: 12px;
  width: 24px; height: 24px; border-radius: 5px;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  padding: 0; line-height: 1;
}
.hcardIconBtn:hover { background: rgba(0,0,0,0.8); }

/* ── Staged card ── */
.hcardStaged {
  box-shadow: 0 0 0 2px #4ADE80, 0 4px 16px rgba(74,222,128,0.25);
}

.hcardConfirm {
  display: flex; gap: 4px; padding: 6px 6px 4px;
}
.hcard:not(.hcardHasImg) .hcardConfirm { padding-top: 6px; }
.hcardHasImg .hcardConfirm { position: absolute; bottom: 0; left: 0; right: 0; padding: 6px; background: rgba(0,0,0,0.7); border-radius: 0 0 5px 5px; }

.confirmBtn {
  flex: 1; color: #fff; font-size: 11px; font-weight: 700;
  padding: 5px 0; border-radius: 5px; border: none; cursor: pointer;
}
.confirmBtn:hover { filter: brightness(1.15); }

.cancelBtn {
  background: rgba(255,255,255,0.08); color: #94A3B8; font-size: 11px;
  padding: 5px 10px; border-radius: 5px; border: 1px solid rgba(255,255,255,0.1);
  cursor: pointer;
}
.cancelBtn:hover { background: rgba(255,255,255,0.15); }
```

**Step 3: Remove broken hover-to-zoom CSS and JSX**

Remove from `CourtBoard.module.css` the `.hcardZoom`, `.handL .hcardZoom`, `.handR .hcardZoom`, `.hcard:hover .hcardZoom` rules added earlier.

Remove the `<img ... className={styles.hcardZoom} />` element from the HandPanel JSX (it was in the old version).

**Step 4: Make .hcard position relative (needed for icon positioning)**

The `.hcard` rule already exists. Ensure it has `position: relative;`.

**Step 5: Verify build and test**

Run: `npm run build`
Test: In a game, hand cards show eye + play icons. Eye opens lightbox. Play stages the card with green glow and Confirm/Cancel. Confirm triggers the card execution flow. Dimmed cards only show eye icon.

**Step 6: Commit**

```bash
git add src/components/game/CourtBoard.jsx src/components/game/CourtBoard.module.css
git commit -m "feat: rework hand panel with staged confirm and lightbox view"
```

---

### Task 5: Wire lightbox into game board matchup slots

**Files:**
- Modify: `src/components/game/CourtBoard.jsx:350-421` (PlayerSlot function)
- Modify: `src/components/game/CourtBoard.module.css`

**Step 1: Add eye icon to PlayerSlot**

In the `PlayerSlot` function, add the lightbox import (already added in Task 4) and an eye icon button next to the player name:

```jsx
function PlayerSlot({ player, ... }) {
  const { open } = useLightbox();
  // ...existing code...
  // In the cardTop div, add an eye button:
  <div className={styles.cardTop}>
    <div className={styles.cardName} style={{ color: col }}>
      {player.name}
      <button className={styles.viewPlayerBtn} onClick={e => { e.stopPropagation(); open('player', player); }}
        title="View card">👁</button>
    </div>
    {/* ...markers unchanged... */}
  </div>
```

**Step 2: Add CSS for the view button**

```css
.viewPlayerBtn {
  background: none; border: none; color: #64748B;
  font-size: 10px; cursor: pointer; padding: 0 0 0 4px;
  vertical-align: middle;
}
.viewPlayerBtn:hover { color: #E2E8F0; }
```

**Step 3: Verify and commit**

Run: `npm run build`

```bash
git add src/components/game/CourtBoard.jsx src/components/game/CourtBoard.module.css
git commit -m "feat: add player card view button on game board matchup slots"
```

---

### Task 6: Final cleanup and deploy

**Step 1: Remove the old `PLAYER_IMAGE_IDS` export if anything still imports it**

Search codebase for `PLAYER_IMAGE_IDS` — if no imports remain, leave as-is (already removed in cardImages.js).

**Step 2: Full build test**

Run: `npm run build`

**Step 3: Manual smoke test**

- Cards tab: click player → lightbox with image + stats → click magnifying glass → full res
- Strats tab: click strategy card → lightbox with image + description
- Team Builder: click player in pool → lightbox. Click name in roster → lightbox
- Game board hand: eye icon → lightbox. Play icon → staged → Confirm Play → card executes
- Game board matchup: eye icon on player → lightbox

**Step 4: Deploy**

Run: `npm run deploy`
