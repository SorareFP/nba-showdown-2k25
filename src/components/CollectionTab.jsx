import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../firebase/AuthProvider.jsx';
import { loadTeams, deleteTeam, updateTeam } from '../firebase/savedTeams.js';
import { loadDecks, deleteDeck } from '../firebase/savedDecks.js';
import { loadCollection, getUserData, loadClaims, addCoins, readSupply, updateUserFields } from '../firebase/collection.js';
// EVERY VALUE-MOVING CALL COMES THROUGH THE SWITCH. Importing them from
// collection.js or market.js directly would bypass USE_CLOUD_FUNCTIONS, which
// is exactly how the first version of the server rollout was wired to nothing.
import {
  openPack, listCard, burnCard, claimGoal, devResetAccount, devGrantCoins, USE_CLOUD_FUNCTIONS, collectCard, collectAllCards,
  setFavoriteTeam } from '../firebase/serverWrites.js';
import { CARD_MAP } from '../game/cards.js';
import { STRAT_MAP } from '../game/strats.js';
import { PACK_TYPES } from '../game/packEngine.js';
import DeckEditor from './DeckEditor.jsx';
import TeamEditor from './TeamEditor.jsx';
import PackShop from './PackShop.jsx';
import PackOpening from './PackOpening.jsx';
import MyCollection from './MyCollection.jsx';
import Market from './Market.jsx';
import CollectionGoals from './CollectionGoals.jsx';
import FavoriteTeamPicker, { teamForOption, favoriteTeamName } from './FavoriteTeamPicker.jsx';
import { logoSrc } from '../cards/CardTemplate.jsx';
import { useDialogs } from '../ui/dialogs.jsx';
import Skeleton from '../ui/Skeleton.jsx';
import { collectableKeys } from '../game/collections.js';
import styles from './CollectionTab.module.css';

const VIEWS = [
  { key: 'teams', label: 'My Teams' },
  { key: 'decks', label: 'My Decks' },
  { key: 'collection', label: 'My Collection' },
  { key: 'goals', label: 'Collections' },
  { key: 'shop', label: 'Pack Shop' },
  // THE MARKET IS NOT THE SHOP. The shop sells packs, which mint; the market is
  // players selling copies that already exist. Keeping them as separate views
  // is the clearest way to stop the second reading as the first.
  { key: 'market', label: 'Market' },
];

export default function CollectionTab({ onLoadTeam, onCollectionChange, initialView = null }) {
  const { user } = useAuth();
  const { ask } = useDialogs();
  // The home page opens a section directly (the Pack Shop, the collections).
  const [view, setView] = useState(() => (VIEWS.some(v => v.key === initialView) ? initialView : 'teams'));
  const [teams, setTeams] = useState([]);
  const [decks, setDecks] = useState([]);
  const [collection, setCollection] = useState({});
  const [userData, setUserData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [expandedTeam, setExpandedTeam] = useState(null);
  const [expandedDeck, setExpandedDeck] = useState(null);
  const [editingDeck, setEditingDeck] = useState(null);
  const [editingTeam, setEditingTeam] = useState(null); // null | 'new' | team
  const [openingPack, setOpeningPack] = useState(null);
  const [claims, setClaims] = useState({});
  const [busyGoal, setBusyGoal] = useState(null);
  const [busyCard, setBusyCard] = useState(null);
  const [toast, setToast] = useState(null);
  // HOW MANY OF EACH CARD ARE IN CIRCULATION, read once with everything else
  // rather than at the moment a pack is bought. Two reasons: opening a pack has
  // to be instant, and supply is designed to move over a SEASON — a count that
  // is a few minutes stale changes a pull weight by nothing anyone could feel.
  // Empty until it loads, and an empty map is exactly the uniform behaviour the
  // engine had before supply existed, so a slow or failed read costs fairness,
  // never a broken pack.
  const [supply, setSupply] = useState({});
  // The permanent choice: null until it is made, and then never null again.
  // See FavoriteTeamPicker for why it is a screen rather than a dropdown.
  const [pickingTeam, setPickingTeam] = useState(false);
  const [teamBusy, setTeamBusy] = useState(false);
  const [teamError, setTeamError] = useState(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const [t, d, c, u, cl, sup] = await Promise.all([
      loadTeams(user.uid),
      loadDecks(user.uid),
      loadCollection(user.uid),
      getUserData(user.uid),
      loadClaims(user.uid),
      // Supply is global rather than per-user and is the one read here that
      // nothing breaks without, so a failure degrades to uniform pulls instead
      // of taking the whole tab down with it.
      readSupply().catch(() => ({})),
    ]);
    setTeams(t);
    setDecks(d);
    setCollection(c);
    setUserData(u);
    setClaims(cl);
    setSupply(sup);
    setLoading(false);
  }, [user]);

  useEffect(() => { refresh(); }, [refresh]);

  // Show starter pack prompt if not opened
  // `undefined` counts as not opened: older accounts have no field and are
  // no longer migrated (the rules refuse that write from here).
  const showStarterPrompt = userData && !userData.starterPackOpened;

  // THE ORDER MATTERS: the starter's three commons and an uncommon are drawn
  // from the favourite team on the SERVER, off the user document, so a starter
  // opened before the choice is made is a starter that never gets the core.
  // The button waits.
  const favorite = userData?.favoriteTeam ?? null;
  const favoriteTeam = favorite ? teamForOption(favorite) : null;

  const handlePickTeam = async option => {
    setTeamBusy(true);
    setTeamError(null);
    try {
      const { favoriteTeam: chosen } = await setFavoriteTeam(user.uid, option);
      setUserData(u => (u ? { ...u, favoriteTeam: chosen } : u));
      setPickingTeam(false);
      setToast(`${favoriteTeamName(chosen)} it is — that one is for good.`);
      // STRAIGHT INTO THE PACK. The choice used to swap the banner's button
      // and wait for a second click, which read as being stuck (reports,
      // 2026-09-08). The pack is what they came for; open it.
      if (userData && !userData.starterPackOpened) await handleOpenStarter();
    } catch (e) {
      setTeamError(e.message);
    } finally {
      setTeamBusy(false);
    }
  };

  const handleDeleteTeam = async (teamId) => {
    if (!await ask({ title: 'Delete this team?', body: 'The cards stay in your collection.', confirmLabel: 'Delete', tone: 'danger' })) return;
    await deleteTeam(user.uid, teamId);
    refresh();
  };

  const handleDeleteDeck = async (deckId) => {
    if (!await ask({ title: 'Delete this deck?', body: 'The strategy cards stay in your collection.', confirmLabel: 'Delete', tone: 'danger' })) return;
    await deleteDeck(user.uid, deckId);
    refresh();
  };

  const handleDeckSaved = () => {
    setEditingDeck(null);
    refresh();
  };

  const handleLinkDeck = async (teamId, deckId) => {
    await updateTeam(user.uid, teamId, { linkedDeckId: deckId || null });
    refresh();
  };

  const getDeckName = (deckId) => {
    if (!deckId) return null;
    const d = decks.find(dk => dk.id === deckId);
    return d?.name || null;
  };

  // THE SERVER ROLLS THE DICE, so it is asked BEFORE the reveal: the cards it
  // returns are the player's the moment the call returns, and the animation is
  // a replay. Saving after the animation — the old order — cannot work when the
  // server chooses the cards, and was never safe anyway: a pack shown and then
  // not saved. The direct route saves first too now, so there is one flow.
  const handleBuyPack = async (packType, options) => {
    try {
      const { cards, spent } = await openPack(user.uid, packType, options, supply);
      // The server has already taken the coins; show it now rather than after
      // the reveal, so the balance on the reveal screen is the real one.
      setUserData(u => (u ? { ...u, currency: (u.currency ?? 0) - (spent ?? 0) } : u));
      setOpeningPack({ cards, packType, options });
    } catch (e) {
      setToast(e.message);
    }
  };

  // The starter pack does NOT get supply. It is every player's first twenty
  // cards and it should be the same draw for everybody — weighting it by what
  // the existing playerbase already owns would hand later arrivals a different
  // starter than early ones, which is the opposite of what a starter is for.
  // Both routes honour that (`once` packs skip the supply weighting).
  const handleOpenStarter = async () => {
    try {
      const { cards, spent } = await openPack(user.uid, 'starter', {});
      setUserData(u => (u ? { ...u, currency: (u.currency ?? 0) - (spent ?? 0) } : u));
      setOpeningPack({ cards, packType: 'starter', options: {} });
    } catch (e) {
      setToast(e.message);
    }
  };

  // Nothing to save here any more — the pack was recorded before it was shown.
  // A resumed box that has now been opened to the end clears its saved reveal.
  const handlePackDone = async () => {
    if (!openingPack) return;
    const wasResumed = openingPack.resumed;
    setOpeningPack(null);
    if (wasResumed) {
      try { await updateUserFields(user.uid, { 'settings.pendingReveals': [] }); } catch { /* cosmetic */ }
    }
    setView('collection');
    refresh();
    onCollectionChange?.();
  };

  // THE REST OF THE BOX, PUT DOWN. `settings` is the one field on the user
  // record the rules let the browser write, and this is presentation, not
  // value: every card in `rest` is already in the ledger. Losing this list
  // would lose a reveal, never a card.
  const handleSaveRest = async rest => {
    try {
      await updateUserFields(user.uid, { 'settings.pendingReveals': rest });
      setToast(`${new Set(rest.map(r => r.packIndex)).size} packs saved — open them from the shop whenever.`);
    } catch (e) {
      setToast(`Could not save the rest: ${e.message}`);
    }
    setOpeningPack(null);
    setView('collection');
    refresh();
    onCollectionChange?.();
  };

  const pendingReveals = userData?.settings?.pendingReveals ?? [];
  const handleResume = () => {
    if (!pendingReveals.length) return;
    setOpeningPack({ cards: pendingReveals, packType: 'booster_box', options: {}, resumed: true });
  };

  const handleList = async (cardId, price) => {
    try {
      await listCard(user.uid, cardId, price);
    } catch (e) {
      // listCard is the authority on what may be sold — the UI hides the button
      // for a protected copy, but a refusal still has to be shown rather than
      // swallowed, because the button is a request and not a permission.
      setToast(e.message);
      return;
    }
    setToast('Listed on the market');
    refresh();
    onCollectionChange?.();
  };

  // The value is not passed: both routes price a burn from the card's rarity.
  // MyCollection still hands it over for display and it is simply ignored.
  const handleBurn = async cardId => {
    try {
      await burnCard(user.uid, cardId);
    } catch (e) {
      // The lock is enforced in burnCard, so this is the path a locked card
      // takes even though the UI hides its burn button — surface it rather
      // than swallowing it.
      setToast(e.message);
      return;
    }
    refresh();
    onCollectionChange?.();
  };

  /**
   * Claim one completed goal.
   *
   * Eligibility is re-derived server-side inside claimGoal, so the button is a
   * request rather than an authority — which is why a failure here is shown and
   * not treated as impossible.
   */
  const handleCollect = async (cardKey) => {
    setBusyCard(cardKey);
    try {
      await collectCard(user.uid, cardKey);
      setToast(`${CARD_MAP[cardKey]?.name ?? cardKey} is in your collection.`);
      await refresh();
      onCollectionChange?.();
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyCard(null);
    }
  };

  // Every collectable card at once — see collectAllCards on the server.
  const handleCollectAll = async () => {
    const n = collectableKeys(collection).size;
    if (!n) return;
    if (!await ask({ title: `Collect all ${n}?`, body: 'One spare of every uncollected player card goes into your collection. Collected copies cannot be sold or burned.', confirmLabel: `Collect ${n}` })) return;
    setBusyCard('all');
    try {
      const r = await collectAllCards(user.uid);
      setToast(`${r.collected} card${r.collected === 1 ? '' : 's'} collected.`);
      await refresh();
      onCollectionChange?.();
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyCard(null);
    }
  };

  const handleClaim = async (goalId) => {
    setBusyGoal(goalId);
    try {
      const res = await claimGoal(user.uid, goalId);
      const card = res.card ? CARD_MAP[res.card]?.name ?? res.card : null;
      setToast(
        card
          ? `Claimed! ${card}${res.coins ? ` and ${res.coins.toLocaleString()} coins` : ''}.`
          : `Claimed ${res.coins.toLocaleString()} coins.`
      );
      await refresh();
      onCollectionChange?.();
    } catch (e) {
      setToast(e.message);
    } finally {
      setBusyGoal(null);
    }
  };

  /**
   * DEV: top the balance up so packs can be opened without grinding.
   *
   * A BUTTON RATHER THAN A SCRIPT, because the account is the signed-in user's
   * and nothing outside the browser holds their credentials. Gated by the same
   * check the reset button uses, and it ADDS rather than sets — so pressing it
   * twice is not a surprise, and it cannot silently wipe a real balance.
   */
  const DEV_COIN_GRANT = 1000000;
  const handleGrantCoins = async () => {
    if (USE_CLOUD_FUNCTIONS) await devGrantCoins(user.uid, DEV_COIN_GRANT);
    else await addCoins(user.uid, DEV_COIN_GRANT);
    await refresh();
    onCollectionChange?.();
    setToast(`DEV: added ${DEV_COIN_GRANT.toLocaleString()} coins.`);
  };

  // DEV: Reset account for testing
  // DEV: reset this account to a fresh one. Through the switch, so it is the
  // server doing it once the flag is on — the old direct writes stop working
  // the moment the rules land, localhost or not, because localhost talks to
  // the real Firestore. The server hands every deleted copy back to supply,
  // which the old version never did.
  const handleResetAccount = async () => {
    const yes = await ask({
      title: 'Reset this account?',
      body: 'Collection, ledger, currency, teams, decks and starter-pack status — all of it. This cannot be undone.',
      warn: 'DEV TOOL',
      confirmLabel: 'Wipe it',
      tone: 'danger',
    });
    if (!yes) return;
    try {
      const r = await devResetAccount(user.uid);
      setToast(`DEV: reset — ${r.copies} copies, ${r.teams} teams, ${r.decks} decks, ${r.claims} claims, ${r.listings} listings cleared. Refresh for the starter pack.`);
    } catch (e) {
      setToast(`DEV reset failed: ${e.message}`);
    }
    await refresh();
    onCollectionChange?.();
  };

  // Pack opening screen takes over
  if (openingPack) {
    return (
      <PackOpening
        cards={openingPack.cards}
        coins={userData?.currency ?? 0}
        onDone={handlePackDone}
        onSaveRest={openingPack.packType === 'booster_box' ? handleSaveRest : null}
      />
    );
  }

  // The collection-only team editor takes over the tab the way the deck
  // editor does — one thing on screen — and the collection it draws from is
  // the one this tab has already loaded.
  if (editingTeam) {
    return (
      <TeamEditor
        team={editingTeam === 'new' ? null : editingTeam}
        collection={collection}
        onSaved={() => { setEditingTeam(null); refresh(); }}
        onCancel={() => setEditingTeam(null)}
      />
    );
  }

  if (editingDeck) {
    return (
      <DeckEditor
        deck={editingDeck === 'new' ? null : editingDeck}
        onSave={handleDeckSaved}
        onCancel={() => setEditingDeck(null)}
        collection={collection}
      />
    );
  }

  // Cards in the box that are not in the binder yet — the dot on the tab.
  const collectable = collectableKeys(collection).size;

  return (
    <div className={styles.wrap}>
      {/* Starter pack banner */}
      {showStarterPrompt && (
        <div className={styles.starterBanner}>
          <div className={styles.starterText}>
            {favoriteTeam
              ? `Welcome! Your Starter Pack has ${favoriteTeam.city} ${favoriteTeam.name} cards in it — and Unethical Hoops, our gift for signing up.`
              : 'Welcome! Pick the team you support — your Starter Pack is built around them, and it carries Unethical Hoops, our gift for signing up.'}
          </div>
          {favoriteTeam ? (
            <button className={styles.starterBtn} onClick={handleOpenStarter}>
              Open Starter Pack
            </button>
          ) : (
            <button className={styles.starterBtn} onClick={() => setPickingTeam(true)}>
              Pick my team
            </button>
          )}
        </div>
      )}

      {/* An account that predates the choice, or one that skipped it. */}
      {!showStarterPrompt && userData && !favorite && (
        <div className={styles.favoriteBanner}>
          <div className={styles.starterText}>
            Pick the team you support. One choice, and it is permanent.
          </div>
          <button className={styles.favoriteBtn} onClick={() => setPickingTeam(true)}>Pick my team</button>
        </div>
      )}

      {pickingTeam && (
        <FavoriteTeamPicker
          busy={teamBusy}
          error={teamError}
          onChoose={handlePickTeam}
          onCancel={teamBusy ? null : () => { setPickingTeam(false); setTeamError(null); }}
        />
      )}

      {/* Sub-navigation */}
      <div className={styles.subNav}>
        {VIEWS.map(v => (
          <button
            key={v.key}
            className={`${styles.subNavBtn} ${view === v.key ? styles.subNavActive : ''}`}
            onClick={() => setView(v.key)}
          >
            {v.label}
            {v.key === 'collection' && collectable > 0 && (
              <span className={styles.navDot} title={`${collectable} card${collectable === 1 ? '' : 's'} waiting to be collected`}>
                {collectable}
              </span>
            )}
          </button>
        ))}
        {favoriteTeam && (
          <div className={styles.navFavorite} title={`Your team: ${favoriteTeam.city} ${favoriteTeam.name}. This choice is permanent.`}>
            {favoriteTeam.logo
              ? <img className={styles.navCrest} src={logoSrc(favoriteTeam.logo)} alt="" />
              : <span className={styles.navCrestDot} style={{ background: favoriteTeam.primary }} />}
            {favoriteTeam.name}
          </div>
        )}
        {userData && (
          <div className={styles.navBalance}>
            <span className={styles.coinIcon}>$</span>{userData.currency ?? 0} coins
          </div>
        )}
      </div>

      {/* ── My Teams ── */}
      {view === 'teams' && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>My Teams</h2>
            <button className={styles.newBtn} onClick={() => setEditingTeam('new')}>+ New Team</button>
          </div>
          {loading && <Skeleton rows={3} height={52} label="Loading your teams" />}
          {!loading && teams.length === 0 && (
            <div className={styles.empty}>No saved teams yet. Build one from your collection.</div>
          )}
          <div className={styles.list}>
            {teams.map(t => (
              <div key={t.id} className={styles.item}>
                <div className={styles.itemHeader} onClick={() => setExpandedTeam(expandedTeam === t.id ? null : t.id)}>
                  <div>
                    <div className={styles.itemName}>{t.name}</div>
                    <div className={styles.itemMeta}>
                      {t.players.length} players · ${t.salary}
                      {getDeckName(t.linkedDeckId) && ` · 🃏 ${getDeckName(t.linkedDeckId)}`}
                      {t.updatedAt?.toDate && ` · ${t.updatedAt.toDate().toLocaleDateString()}`}
                    </div>
                  </div>
                  <span className={styles.chevron}>{expandedTeam === t.id ? '▾' : '▸'}</span>
                </div>
                {expandedTeam === t.id && (
                  <div className={styles.itemBody}>
                    <div className={styles.playerList}>
                      {t.players.map(pid => {
                        const c = CARD_MAP[pid];
                        return c ? (
                          <div key={pid} className={styles.playerRow}>
                            <span>{c.name}</span>
                            <span className={styles.playerMeta}>{c.team} · S{c.speed} P{c.power} · ${c.salary}</span>
                          </div>
                        ) : <div key={pid} className={styles.playerRow}>{pid}</div>;
                      })}
                    </div>
                    {decks.length > 0 && (
                      <div className={styles.linkDeck}>
                        <label className={styles.linkLabel}>Strategy Deck</label>
                        <select
                          className={styles.linkSelect}
                          value={t.linkedDeckId || ''}
                          onChange={e => handleLinkDeck(t.id, e.target.value)}
                        >
                          <option value="">None (use default)</option>
                          {decks.map(d => (
                            <option key={d.id} value={d.id}>{d.name} ({d.totalCards}/50)</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className={styles.itemActions}>
                      <button className={styles.loadBtn} onClick={() => onLoadTeam(t, 'A')}>Load as Team A</button>
                      <button className={styles.loadBtnB} onClick={() => onLoadTeam(t, 'B')}>Load as Team B</button>
                      <button className={styles.editBtn} onClick={() => setEditingTeam(t)}>Edit</button>
                      <button className={styles.deleteBtn} onClick={() => handleDeleteTeam(t.id)}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── My Decks ── */}
      {view === 'decks' && (
        <div className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2 className={styles.sectionTitle}>My Decks</h2>
            <button className={styles.newBtn} onClick={() => setEditingDeck('new')}>+ New Deck</button>
          </div>
          {loading && <Skeleton rows={3} height={52} label="Loading your decks" />}
          {!loading && decks.length === 0 && (
            <div className={styles.empty}>No saved decks yet. Create one to build your strategy card deck.</div>
          )}
          <div className={styles.list}>
            {decks.map(d => (
              <div key={d.id} className={styles.item}>
                <div className={styles.itemHeader} onClick={() => setExpandedDeck(expandedDeck === d.id ? null : d.id)}>
                  <div>
                    <div className={styles.itemName}>{d.name}</div>
                    <div className={styles.itemMeta}>
                      {d.totalCards}/50 cards
                      {d.updatedAt?.toDate && ` · ${d.updatedAt.toDate().toLocaleDateString()}`}
                    </div>
                  </div>
                  <span className={styles.chevron}>{expandedDeck === d.id ? '▾' : '▸'}</span>
                </div>
                {expandedDeck === d.id && (
                  <div className={styles.itemBody}>
                    <div className={styles.deckContents}>
                      {Object.entries(d.cards || {}).filter(([, n]) => n > 0).sort((a, b) => a[0].localeCompare(b[0])).map(([cardId, count]) => {
                        const s = STRAT_MAP[cardId];
                        return (
                          <div key={cardId} className={styles.deckRow}>
                            <span className={styles.deckCardName} style={{ borderLeftColor: s?.color || '#666' }}>
                              {s?.name || cardId}
                            </span>
                            <span className={styles.deckCardCount}>x{count}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className={styles.itemActions}>
                      <button className={styles.editBtn} onClick={() => setEditingDeck(d)}>Edit</button>
                      <button className={styles.deleteBtn} onClick={() => handleDeleteDeck(d.id)}>Delete</button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── My Collection ── */}
      {view === 'collection' && (
        <MyCollection collection={collection} onBurn={handleBurn} onList={handleList} onCollect={handleCollect} onCollectAll={handleCollectAll} collectableCount={collectable} />
      )}

      {/* ── Collections (the goal ladder) ── */}
      {view === 'goals' && (
        <CollectionGoals
          collection={collection}
          claims={claims}
          coins={userData?.currency ?? 0}
          onClaim={handleClaim}
          onCollect={handleCollect}
          busyGoal={busyGoal}
          busyCard={busyCard}
        />
      )}

      {/* ── Pack Shop ── */}
      {view === 'market' && (
        <Market
          uid={user.uid}
          coins={userData?.currency ?? 0}
          onTraded={() => { refresh(); onCollectionChange?.(); }}
        />
      )}

      {view === 'shop' && (
        <>
          {pendingReveals.length > 0 && (
            <div style={{ margin: '0 0 16px', padding: '12px 16px', border: '1px solid var(--orange)', borderRadius: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <strong>{new Set(pendingReveals.map(r => r.packIndex)).size} packs still to open</strong>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>From a booster box you put down. The cards are already yours.</div>
              </div>
              <button className={styles.loadBtn} onClick={handleResume}>Open them</button>
            </div>
          )}
          <PackShop currency={userData?.currency ?? 0} onBuyPack={handleBuyPack} />
        </>
      )}

      {toast && (
        <div className={styles.toast} role="status" onClick={() => setToast(null)}>
          {toast}
          <button className={styles.toastClose} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* DEV: Reset button — localhost or admin only */}
      {/* DEV TOOLS. Dev builds only — `import.meta.env.DEV` is false under
          `npm run build`, so nothing here ships — and only for the game's own
          account. The reset goes through the switch and keeps working after
          the rules land. Granting coins has no server route (there is no
          honest one), so it shows only while the direct path is live. */}
      {import.meta.env.DEV && (window.location.hostname === 'localhost' || user?.email === 'hoopsonhoops@gmail.com') && (
        <div style={{ marginTop: 32, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
          <button
            onClick={handleGrantCoins}
            style={{ background: 'none', color: 'var(--gold)', fontSize: 11, padding: '4px 10px', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 4, marginRight: 8 }}
          >
            DEV: +1,000,000 coins
          </button>
          <button
            onClick={handleResetAccount}
            style={{ background: 'none', color: 'var(--red)', fontSize: 11, padding: '4px 10px', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, marginRight: 8 }}
          >
            DEV: Reset Collection &amp; Currency
          </button>

        </div>
      )}
    </div>
  );
}
