// AWARD MARKS — the trophies a player won IN THE SEASON THIS CARD IS.
//
// The user's words: "I'm going to add some awards to [a folder], and I'd like
// to add them to the sidebar above the badges if a player won them. I'll label
// as MVP, MIP, DPOY, etc."
//
// ── WHAT AN AWARD MARK IS, AND WHY IT IS NOT A BADGE ────────────────────────
//
// A BADGE says what KIND of card this is — SUPER SEASON, ROOKIE — and exactly
// one prints, because the card is one kind of thing. An AWARD says what the
// player DID in the season the card's numbers came from, and a player can have
// done several: Shai Gilgeous-Alexander won MVP and Clutch Player of the Year
// in 2025-26, and a rule that printed one of those and swallowed the other
// would be throwing away the fact the mark exists to carry.
//
// So this is a LIST where badges.js is a choice. The two live in separate files
// for that reason and not merely for size: `pickBadge` resolves many ids down
// to one and `pickAwards` resolves many down to several, and folding them
// together would mean one of the two rules pretending to be the other.
//
// ── WHICH CODES QUALIFY, AND WHY FOUR OF THE FIVE SELECTIONS DO NOT ─────────
//
// Basketball-Reference's season tables carry one `awards` string per player,
// and it mixes two different kinds of thing:
//
//   VOTED TROPHIES   MVP, DPOY, ROY, MIP, 6MOY, CPOY. One winner a season,
//                    and the suffix is the finishing position — `MVP-1` won,
//                    `MVP-4` came fourth. See AWARD_WIN_RANK.
//
//   SELECTIONS       AS (All-Star), NBA1/NBA2/NBA3 (All-NBA), DEF1/DEF2
//                    (All-Defensive). No rank suffix, because there is no
//                    single winner to rank against.
//
// THOSE TWELVE ARE ALL OF THEM — IN THE TABLE THE GENERATOR ACTUALLY READS,
// which is a narrower and much more fragile claim than the one this comment
// used to make, and the difference is worth spelling out because it was checked
// against the live site and the old wording was WRONG about why.
//
// The old wording said Finals MVP "never appears in this column" because
// Basketball-Reference's season tables are regular-season tables. They are not.
// `NBA_2026_advanced.html` carries TWO tables — `<table id="advanced">` for the
// regular season and `<table id="advanced_post">` for the playoffs — and the
// postseason one carries, on Jalen Brunson's 2026 row:
//
//     <td data-stat="awards"><b><a href="/awards/finals_mvp.html">
//        Finals MVP-1</a></b></td>
//
// THAT TOKEN CONTAINS A SPACE, and it is the one string on the site that could
// put a REGULAR-SEASON MVP MARK ON A FINALS MVP: a parser splitting on
// `[,\s]+` yields `Finals` and `MVP-1`, and `MVP-1` satisfies the `-1` rule
// exactly. Two things stop that, both of them load-bearing and both of them now
// pinned by tests rather than by luck:
//
//   THE TABLE IS NEVER READ. `isolateTableBody` matches `id="advanced"`
//   INCLUDING the closing quote, so `id="advanced_post"` is not a match and the
//   playoff rows are outside the slice. Checked live: 733 regular-season rows
//   parsed from that page, 54 with awards, and `Finals` in none of them.
//
//   AND THE TOKEN WOULD BE REFUSED ANYWAY. `codesIn` splits on `,` ALONE — not
//   on whitespace — and TOKEN then requires the whole token to be
//   `[A-Za-z0-9]+` with an optional `-{digits}`. `Finals MVP-1` has a space in
//   the middle, matches nothing, and `parseAwardToken` returns null. So
//   `awardsEarned('MVP-4,Finals MVP-1')` is empty, and the compound token
//   cannot be mistaken for the trophy even if the scoping above ever fails.
//
// NEITHER of those is a coincidence to be relied on quietly, so awards.test.js
// asserts both, by name, against the real strings. If a future reader is tempted
// to "tidy" the split into `[,\s]+`, that test is what stops him.
//
// FINALS MVP IS NOT A MARK, and that is a decision rather than a limitation: the
// user has not asked for one, so the default is to leave it out. What matters is
// only that it never masquerades as the regular-season MVP, which is what the
// above is about. Adding it later would be a row here plus reading the
// `advanced_post` table — not a change to any rule below.
//
// SEVEN OF THE TWELVE PRINT: the six trophies, and ALL-STAR.
//
// All-Star is here on the user's call — "AS should map to the All-Star file" —
// made with the cost in front of him, and it is a real cost. Measured on the
// generated data rather than argued (card-data/generated/card-awards.json
// records the counts, so these regenerate rather than rotting):
//
//        super-season   15 marked cards -> 44   (7% of the set -> 21%)
//        2026-27         5 marked cards -> 31   (1% -> 9%)
//        rookie         11 marked cards -> 11   (3% -> 3%)
//
// The rookie set does not move AT ALL, and that is a fact about the pool rather
// than a bug: no player in it was an All-Star in his rookie year. Blake Griffin
// (`MVP-10,ROY-1,AS`, 2010-11) is the case that would have, and he is retired
// and therefore not in the pool.
//
// THE OTHER FOUR STAY OUT — All-NBA (NBA1/2/3) and All-Defensive (DEF1/2) —
// and the numbers above are why the line falls between them and All-Star
// rather than around all five. 24+ players make an All-Star team every season;
// admitting them costs the Super Season set a fifth. All-NBA puts 15 more on
// the list and All-Defensive another 10, and those two overlap so heavily with
// the All-Star team and with each other that what they mostly add is a SECOND
// and THIRD mark to the cards that already have one — which spends the row's
// three slots without telling a reader anything the first mark did not. A mark
// better than a third of a set carries is not a mark, it is a background, and
// that is the same argument SUPER_SEASON_MIN_SALARY was moved for one file
// over.
//
// (The 37% figure quoted while this was being decided was `ifSelectionsCounted`
// in the generated file, which answers the wider question — what if EVERY
// selection counted. All-Star ALONE is the 21% above. The two numbers are both
// in card-awards.json and neither is a typo for the other.)
//
// AND THE PARSING RULE STILL ONLY APPLIES TO THE TROPHIES. A trophy is earned
// by finishing FIRST, a selection has no finishing position, and the two shapes
// are read by two functions that meet in exactly one place — `awardsEarned`.
// Admitting All-Star did not soften the `-1` rule by a hair: Luka Dončić's
// `MVP-4,CPOY-8,AS,NBA1` still yields no MVP mark and now yields an All-Star
// one, off the same record, in the same call. That is the test.
//
// ONE LINE TO CHANGE. AWARDS below is the whole declaration: adding NBA1 to it
// is adding a row, and everything downstream — the generator, the ordering, the
// cap, the studio — reads it from here.
import { pickInkFor } from './fieldTheme.js';

/**
 * The finishing position that IS a win.
 *
 * THE SINGLE MOST DANGEROUS NUMBER IN THIS FILE. Basketball-Reference writes a
 * voted award as `{CODE}-{PLACE}`, so `MVP-1` is the Most Valuable Player and
 * `MVP-4` is a player who finished fourth in the voting and won nothing. Ten to
 * fifteen players carry an `MVP-n` token every season; exactly one of them has
 * an MVP. Reading the code and ignoring the suffix would put a trophy on all of
 * them — Luka Dončić's 2025-26 card, `MVP-4`, is the case the test suite names.
 *
 * There is no second reading of the suffix to get wrong: it is a rank, it is
 * always present on a voted award, and 1 is first.
 */
export const AWARD_WIN_RANK = 1;

/**
 * A single token out of the `awards` string, parsed.
 *
 * Returns `{ code, rank }` with `rank` null for a token that carries no
 * position — the selections, which is how they are told apart from the
 * trophies without this file holding a second list of which is which.
 *
 * Anything that is not one of those two shapes returns null rather than
 * throwing. The string comes off a scraped page: a site change should cost a
 * card its mark, not take the generator down.
 */
const TOKEN = /^([A-Za-z0-9]+)(?:-(\d+))?$/;

export function parseAwardToken(token) {
  const m = TOKEN.exec(String(token ?? '').trim());
  if (!m) return null;
  return { code: m[1], rank: m[2] === undefined ? null : Number(m[2]) };
}

/**
 * Every award code in a Basketball-Reference `awards` string that was WON.
 *
 * "Won" is `rank === AWARD_WIN_RANK` and nothing else. A token with no rank is
 * a selection and is never a win — see the header — so `AS,NBA1,DEF1` yields
 * nothing at all, and `MVP-4,CPOY-8,AS,NBA1` yields nothing at all either.
 *
 * DELIBERATELY DOES NOT FILTER TO THE DECLARED SET. This answers "what did he
 * win", which is a fact; `pickAwards` and `awardsEarned` answer "what does the
 * card print", which is a decision. Keeping them apart is what lets the
 * generator record the whole truth in card-awards.json while the renderer
 * prints the part of it that earns a place — the same split card-badges.json
 * already makes between `applies` and `printed`.
 */
export function awardsWon(raw) {
  return codesIn(raw, parsed => parsed.rank === AWARD_WIN_RANK);
}

/**
 * Every code in the string that carries NO finishing position.
 *
 * The other half of the same fact, and equally declaration-free: `AS,NBA1,DEF1`
 * yields all three, `MVP-4` yields none. WHICH of them prints is not decided
 * here — that is `awardsEarned` against the declaration, where AS is a row and
 * the other four are not — and keeping the two apart is what made admitting
 * All-Star a row rather than a second parser.
 */
export function selectionsIn(raw) {
  return codesIn(raw, parsed => parsed.rank === null);
}

function codesIn(raw, keep) {
  if (typeof raw !== 'string') return [];
  const out = [];
  for (const token of raw.split(',')) {
    const parsed = parseAwardToken(token);
    if (parsed && keep(parsed) && !out.includes(parsed.code)) out.push(parsed.code);
  }
  return out;
}

/**
 * The award marks a card may print, IN PRIORITY ORDER.
 *
 * The order IS the rule, exactly as it is in badges.js: it decides which marks
 * survive MAX_CARD_AWARDS and which order they sit in, and there is no separate
 * priority table to keep in step.
 *
 * The order is the awards' own standing, which is not a matter of taste at the
 * ends and barely one in the middle:
 *
 *   MVP    the league's award. Nothing else on this list is argued about.
 *   DPOY   its defensive counterpart, and the only other award voted on the
 *          whole of a player's game rather than on a slice of it.
 *   ROY    a career fact as much as a season one, and unrepeatable — which is
 *          also why it sits above the two role awards a player can win twice.
 *   MIP    unrepeatable in practice for the same reason ROY is in principle.
 *   6MOY   a role award: it is about the bench, not about the league.
 *   CPOY   a role award over a slice of a season, and the newest of the six
 *          (first awarded 2022-23), so the fewest cards can carry it.
 *   CHAMP  SECOND TO LAST, below every individual trophy and above All-Star.
 *          This is the one placement that had to be argued rather than read
 *          off the list, so:
 *
 *          It cannot sit among the six, because the property that ordered
 *          them is HOW FEW HOLD IT — each of the six has exactly ONE holder a
 *          season, and a ring has fifteen to twenty. Putting a mark that a
 *          fifth of a champion's bench carries above Defensive Player of the
 *          Year would break the same rule the header invokes to keep All-NBA
 *          out: a mark is worth its place in proportion to how few of them
 *          there are. It is also the only mark here that is not a fact about
 *          the PLAYER at all — the other seven are things he did, and this is
 *          something his team did with him on it.
 *
 *          It sits ABOVE All-Star for the same measurement, one step down: a
 *          champion's roster is ~17 men against the All-Star teams' 24-30, the
 *          ring is unarguable where an All-Star nod is voted, and a player can
 *          make twelve All-Star teams and never hold this. Every argument for
 *          All-Star being last is an argument for the championship being above
 *          it.
 *
 *          And the drop order that follows is the right one. On a card holding
 *          four codes it is ALL-STAR that goes, never the ring and never a
 *          trophy — see MAX_CARD_AWARDS.
 *   AS     LAST, and not by a narrow margin. It is the only VOTED SELECTION
 *          here and the only mark 24+ players hold every season, so it is the
 *          least distinguishing of the eight by an order of magnitude. Being
 *          last is also what makes it the FIRST DROPPED when MAX_CARD_AWARDS
 *          bites, which is the correct casualty: a card that won three things
 *          and made the team should print the three it won.
 *
 * `name` is not rendered anywhere on the card. It is here so that the studio,
 * the run report and this file's own tests say "Most Improved Player" instead
 * of making a reader expand the initialism themselves.
 *
 * ── ADDING ONE IS ADDING A ROW, INCLUDING A SELECTION ───────────────────────
 *
 * `selection: true` says this code is HELD rather than WON, and it is what
 * makes admitting a selection a one-line change rather than a one-line change
 * plus a second parsing rule. `awardsEarned` stops requiring a `-1` for that
 * code and takes the bare token instead; nothing else moves — not the
 * generator, not the priority order, not the cap, not the renderer.
 *
 * AS IS THE PROOF OF THAT, and it went in as exactly the one line the flag was
 * written for. NBA1/NBA2/NBA3 and DEF1/DEF2 would each be one more, and the
 * header says why they are not there — the door being cheap is not a reason to
 * walk through it.
 *
 * The CODE IS THE FILENAME BY DEFAULT, and `file` is the exception that proves
 * why. `/awards/{file ?? code}` under public/ — see awardImagePath. For the
 * seven codes that come out of Basketball-Reference's column the two must be
 * the same string, because the code is not ours to choose: it is the site's
 * spelling, it is the side of the join that cannot be renamed, and the art has
 * to be named to match. The user's All-Star file is therefore `AS.…`, not
 * `All-Star.…`.
 *
 * CHAMP IS THE ONE ROW WITH NO SUCH CONSTRAINT. It is not read out of that
 * column and Basketball-Reference has no token for it, so there is no external
 * spelling to honour — which frees the code to be short and semantic and the
 * FILE to be whatever the user actually saved. He saved
 * `public/awards/LarryOBrien.jpg`, named for the trophy, and renaming a file in
 * a directory he is actively curating to satisfy a convention that exists for a
 * different reason would be the tail wagging the dog.
 *
 * ── `external: true` — THIS ROW IS NOT IN THE AWARDS STRING ─────────────────
 *
 * `selection` distinguishes a code that is HELD from one that is WON. `external`
 * answers a question one level up: whether the code comes out of the awards
 * string AT ALL. CHAMP does not — it is a TEAM fact, resolved by the generator
 * from the season's League Champion row and that team's roster, and attached to
 * the record afterwards.
 *
 * So `awardsEarned` must not go looking for it, and the flag is what keeps that
 * honest rather than accidental. Without it the guard would be "the string
 * never contains CHAMP", which is true today and is not a rule — a future token
 * spelled `CHAMP-1` on some page would hand this mark to the ten men who
 * finished second. With it, no awards string can produce this code however it
 * is spelled, and the ONLY thing that can is the roster join.
 */
export const AWARDS = [
  { code: 'MVP', name: 'Most Valuable Player' },
  { code: 'DPOY', name: 'Defensive Player of the Year' },
  { code: 'ROY', name: 'Rookie of the Year' },
  { code: 'MIP', name: 'Most Improved Player' },
  { code: '6MOY', name: 'Sixth Man of the Year' },
  { code: 'CPOY', name: 'Clutch Player of the Year' },
  { code: 'CHAMP', name: 'NBA Champion', file: 'LarryOBrien', external: true },
  { code: 'AS', name: 'All-Star', selection: true },
];

/**
 * The code the champion mark is carried under, for the generator that resolves
 * it.
 *
 * Exported so scripts/cardgen/generateAwards.js never spells 'CHAMP' itself.
 * The generator's job is to decide WHO was on a champion's roster; which code
 * that earns is this file's business, exactly as the -1 rule is.
 */
export const CHAMPION_CODE = 'CHAMP';

const AWARDS_BY_CODE = new Map(AWARDS.map(a => [a.code, a]));

/** Just the codes, in priority order. */
export const AWARD_CODES = AWARDS.map(a => a.code);

/** The declared award with this code, or null. Own-property lookup, never a prototype hit. */
export function getAward(code) {
  return AWARDS_BY_CODE.get(code) ?? null;
}

/**
 * The DECLARED codes one awards string earns a card, in priority order.
 *
 * THE ONE PLACE THE TWO HALVES MEET. `awardsWon` and `selectionsIn` say what
 * the string contains and know nothing about what this build draws; AWARDS says
 * what this build draws and knows nothing about Basketball-Reference's syntax.
 * This is the join, and it is the only function that has to change if the
 * declaration ever admits a code of the other shape — which is what the
 * `selection` flag is for.
 *
 * A ranked award needs its `-1`. A declared selection needs only to be present.
 * AN EXTERNAL AWARD IS NOT REACHABLE FROM HERE AT ALL — no awards string can
 * earn CHAMP, however it is spelled, because the ring is a team fact resolved
 * from a roster and not a token in this column. Nothing else earns a mark.
 *
 * AND THE COMPOUND TOKEN IS REFUSED. `Finals MVP-1` is a real string on
 * Basketball-Reference — see the header — and it reaches neither half: `codesIn`
 * splits on `,` alone and TOKEN rejects the embedded space, so
 * `awardsEarned('MVP-4,Finals MVP-1')` is empty rather than an MVP.
 */
export function awardsEarned(raw) {
  const won = new Set(awardsWon(raw));
  const held = new Set(selectionsIn(raw));
  return AWARDS.filter(a => {
    if (a.external) return false;
    return a.selection ? held.has(a.code) : won.has(a.code);
  }).map(a => a.code);
}

/**
 * Codes filtered to the declaration and sorted into its order, UNCAPPED.
 *
 * The code-level twin of `pickAwards`, and the difference is the cap. This is
 * what the GENERATOR writes into card-awards.json: the file has to record every
 * mark a card has EARNED so that `capped` can count the ones the row cannot
 * draw, and a writer that had already truncated to three could not tell a card
 * holding exactly three from one holding five.
 *
 * It exists because the champion join produces a code OUTSIDE the awards
 * string, so the generator ends up holding two lists — `awardsEarned`'s, in
 * order, and a CHAMP it resolved separately — and concatenating them would put
 * the ring after All-Star, which is neither the declared order nor the drop
 * order. Ordering is declared in one place, and this is the door to it.
 */
export function orderAwardCodes(codes) {
  const wanted = new Set(Array.isArray(codes) ? codes.filter(c => typeof c === 'string') : []);
  return AWARD_CODES.filter(code => wanted.has(code));
}

/**
 * How many marks one card prints.
 *
 * ── FOUR, BECAUSE THE ROW WRAPS NOW ────────────────────────────────────────
 *
 * It was THREE, and three was the bar's width doing the choosing: the sidebar
 * column is 127px of usable width (see .badge — the bar is 135 and the card's
 * keyline takes 7 of them), and three 38px marks with two 6px gaps measured
 * 126. A fourth did not fit across.
 *
 * .awards no longer lays them across. It WRAPS AT TWO — which is what made the
 * marks 59px wide instead of 38 — so three marks are two rows and a fourth
 * costs the second row nothing it has not already spent. 54 + 8 + 54 = 116px
 * whether the card holds three marks or four. The number that used to be the
 * bar's width is now the second row's occupancy, and it is 4.
 *
 * ── AND FOUR IS HEADROOM RATHER THAN A CHANGE ──────────────────────────────
 *
 * NOTHING IS DROPPED TODAY AND NOTHING WAS BEING DROPPED BEFORE. Measured on
 * the generated file rather than argued (`mostHeld` in card-awards.json):
 *
 *        2026-27       most held 3   40 of 61 marked   4 with more than one
 *        super-season  most held 3   51 of 82 marked  13 with more than one
 *        rookie        most held 1   17 of 76 marked   0 with more than one
 *
 * — a maximum of THREE across all three sets, and exactly two cards reach it,
 * both of them Shai Gilgeous-Alexander: the 2026-27 base card
 * (`MVP-1,CPOY-1,AS,NBA1` -> MVP + CPOY + AS) and the Super Season card of his
 * 2024-25 (`MVP-1,DPOY-10,CPOY-8,AS,NBA1` plus Oklahoma City's title -> MVP +
 * CHAMP + AS). So the cap sat exactly ON the ceiling, which is the state it was
 * raised past three to avoid; it now sits one above, and the fourth mark is
 * free.
 *
 * A FOURTH IS REACHABLE, which is why the headroom is worth having: a player
 * who wins a trophy, makes the All-Star team and wins the title already holds
 * three, and one more trophy in the same season makes four. Giannis
 * Antetokounmpo's 2019-20 (MVP + DPOY + AS) is three of those four; had
 * Milwaukee won that June it would have been the card this number exists for.
 *
 * `pickAwards` drops from the BOTTOM of the priority order when it must, so the
 * mark that goes is always the least of them — All-Star first, then the ring,
 * and never a trophy. That ordering is the reason a fifth mark could not cost a
 * card its MVP.
 */
export const MAX_CARD_AWARDS = 4;

/**
 * The marks a card actually prints, from every code it carries.
 *
 * Filters to the declared set, deduplicates, sorts into AWARDS order and caps
 * at MAX_CARD_AWARDS. Unknown codes are ignored rather than throwing, for
 * badges.js's reason: a data file naming an award this build does not declare
 * should cost that card a mark, not take the studio down.
 *
 * Returns the AWARD OBJECTS, not the codes, so a caller cannot print a mark
 * without having gone through the declaration.
 */
export function pickAwards(codes) {
  if (!Array.isArray(codes)) return [];
  const wanted = new Set(codes.filter(c => typeof c === 'string'));
  return AWARDS.filter(a => wanted.has(a.code)).slice(0, MAX_CARD_AWARDS);
}

/**
 * The browser path for an award's art, or null for a code this build does not
 * declare.
 *
 * ROOT-RELATIVE AND BARE, exactly like a team's `logo` in teams.js: this is
 * plain data, read by Node as well as by the browser, so it must not depend on
 * a bundler's environment. CardTemplate runs it through `logoSrc` to pick up
 * the app's base path, the same way it does every other mark on the card.
 *
 * ── public/awards/, NOT card-art/logo-originals/Awards/ ─────────────────────
 *
 * The user named the second one, and it is the wrong home for the same reason
 * it would be for a team mark: card-art/logo-originals/ is the BACKUP store for
 * stripped originals and is not served or bundled. public/awards/ is parallel
 * to public/logos/, which is what actually reaches a card — and, being under
 * public/, is copied verbatim into dist/ by `vite build`, so the same file
 * serves the studio, the built app and the batch export.
 *
 * ── `.png` IS THE SPELLING TRIED FIRST, NOT A REQUIREMENT ───────────────────
 *
 * `assetCandidates` in CardTemplate.jsx retries this stem under every format in
 * IMAGE_EXTENSIONS, so `MVP.avif` and `6MOY.jpg` resolve as readily as a PNG
 * would and nothing here has to know which the user saved. The extension stays
 * on the path because a path is more useful than a stem to everything that is
 * not a browser — a Node exporter can hand this to `assetCandidates` and
 * resolve it against the filesystem with the same list.
 *
 * THE STEM IS THE ROW'S `file`, WHICH DEFAULTS TO ITS CODE. For the seven codes
 * Basketball-Reference names, those are the same string and the stem is not
 * negotiable: the All-Star mark is `AS.…`, and `All-Star.webp` is a file
 * nothing asks for. CHAMP is the row that declares a `file` instead —
 * `LarryOBrien`, which is what the user saved — and the reason it may is that
 * no external source dictates its spelling. See AWARDS.
 *
 * A card whose art is missing under every accepted format falls back to the
 * lettered chip — see AwardMark in CardTemplate.jsx.
 */
export function awardImagePath(code) {
  const award = getAward(code);
  return award ? `/awards/${award.file ?? award.code}.png` : null;
}

/**
 * The lettered chip's two colours: the fill and the type on it.
 *
 * ── NO NEW COLOUR IS INVENTED HERE, AND THAT IS THE WHOLE POINT ─────────────
 *
 * It is the BEST SEASON pill's pair, exactly: the team's `accentOnField`, which
 * `deriveFieldTheme` has already cleared against the field on all thirty-seven
 * franchises, with `pickInkFor` of it for the type. So the chip introduces no
 * surface the card did not already have a contrast argument for, and
 * treatments.test.js sweeps it over every franchise and every treatment
 * alongside the badges rather than exempting it.
 *
 * TAKES THE UNTREATED THEME, for badges.js's reason restated: an award is a
 * fact about a player's season, not about the set the card is in, so the green
 * treatment must not repaint it green and the foil must not repaint it gold.
 * CardTemplate passes `base` here exactly as it does to `badgeVars`.
 */
export function awardColors(theme) {
  if (!theme) return null;
  const fill = theme.accentOnField;
  return { fill, ink: pickInkFor(fill) };
}

/**
 * The chip's colours as CSS custom properties.
 *
 * NOTHING when the card prints no marks, so a card without awards carries no
 * award properties at all — the same contract badgeVars keeps, and for the same
 * reason: the `var(--award-fill, …)` fallbacks in the stylesheet then exist
 * only for a state this file makes possible and does not produce.
 */
export function awardVars(theme, awards) {
  if (!Array.isArray(awards) || awards.length === 0) return {};
  const colors = awardColors(theme);
  if (!colors) return {};
  return { '--award-fill': colors.fill, '--award-ink': colors.ink };
}
