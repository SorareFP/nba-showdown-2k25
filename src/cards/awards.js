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
// THOSE TWELVE ARE ALL OF THEM IN THE REGULAR-SEASON TABLE. There is a
// THIRTEENTH, and it is in a different table on the same page.
//
// ── FINALS MVP, AND THE COMPOUND TOKEN ──────────────────────────────────────
//
// `NBA_2026_advanced.html` carries TWO tables — `<table id="advanced">` for the
// regular season and `<table id="advanced_post">` for the playoffs — and the
// postseason one carries, on Jalen Brunson's 2026 row:
//
//     <td data-stat="awards"><b><a href="/awards/finals_mvp.html">
//        Finals MVP-1</a></b></td>
//
// That is the WHOLE of the playoff column. Verified live for 2004, 2015, 2021
// and 2026: the postseason table holds 230-odd rows a season and EXACTLY ONE of
// them has an awards cell, always `Finals MVP-1`. So reading it adds one mark
// and cannot add anything else — which is what makes it safe to read at all.
//
// THAT TOKEN CONTAINS A SPACE, and it is the one string on the site that could
// put a REGULAR-SEASON MVP MARK ON A FINALS MVP: a parser splitting on
// `[,\s]+` yields `Finals` and `MVP-1`, and `MVP-1` satisfies the `-1` rule
// exactly. ADMITTING THE MARK DID NOT SOFTEN THAT BY A HAIR, and the way it did
// not is the point:
//
//   `codesIn` STILL SPLITS ON `,` ALONE. The separator was never widened and
//   must never be. What changed is TOKEN, which now admits a space INSIDE a
//   code — so `Finals MVP-1` parses as the single code `Finals MVP` at rank 1,
//   and `MVP` is not a substring the parser can ever reach. The space went from
//   being the thing that BROKE the parse to being part of the name, which is
//   the same protection stated positively and is strictly harder to undo by
//   accident: there is no longer a "tidy-up" that turns this into an MVP, only
//   a rewrite.
//
//   AND THE CODE IS NOT THE TOKEN. `Finals MVP` is Basketball-Reference's
//   spelling and it is a poor code and an impossible filename, so the row
//   declares `token: 'Finals MVP'` and carries the code `FMVP`. The join is
//   therefore DECLARED rather than implied by string equality — see AWARDS.
//
//   AND THE PLAYOFF COLUMN CAN EARN NOTHING ELSE. `postSeason: true` is the
//   third flag on a row, beside `selection` and `external`, and it is what
//   `postSeasonAwardsEarned` filters on. The generator reads the regular table
//   through `awardsEarned` and the playoff table through that one, so no string
//   in `advanced_post` can ever produce an All-Star selection or a
//   regular-season trophy however the site rewrites it.
//
// NONE of those is a coincidence to be relied on quietly, so awards.test.js
// asserts all three, by name, against the real strings.
//
// NINE OF THE THIRTEEN PRINT: the six trophies, FINALS MVP, the ring, ALL-STAR.
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
 *
 * ── THE SPACE IS PART OF THE CODE, NEVER A SEPARATOR ────────────────────────
 *
 * A code may contain SINGLE INTERNAL SPACES — `Finals MVP` is the site's own
 * spelling and the only such code today. That is a widening of what a code may
 * LOOK like and emphatically not of how a string is SPLIT: `codesIn` divides on
 * `,` alone, exactly as it always has, so a space can only ever appear in the
 * middle of a token this regex then swallows whole.
 *
 * WHICH IS THE PROTECTION, RESTATED. `Finals MVP-1` yields the one code
 * `Finals MVP` at rank 1. It does not yield `MVP`, because `MVP` is not a token
 * — the anchors mean the code runs from the start of the token to the rank, and
 * a parser that matched a suffix of it would have to be a different parser.
 * `parseAwardToken('Finals MVP-1').code` is asserted to be `'Finals MVP'` in
 * awards.test.js for exactly this reason.
 *
 * `(?: [A-Za-z0-9]+)*` and not `[\s]*`: ONE space, never a tab, a newline or a
 * run — so a cell that arrives with its whitespace mangled by a site change
 * fails to parse and costs a card its mark, which is the scraped-string
 * contract above rather than a guess at what was meant.
 */
const TOKEN = /^([A-Za-z0-9]+(?: [A-Za-z0-9]+)*)(?:-(\d+))?$/;

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
 *   FMVP   SECOND, and the placement is an argument rather than a taste:
 *
 *          BY THE RARITY RULE it belongs among the trophies and not below the
 *          ring. Every one of the six has exactly ONE holder a season and so
 *          does this; a championship has fifteen to twenty. The user's own
 *          words for it were "rarer than a ring", and that is measurable rather
 *          than a feeling — over the twenty-three seasons this build reads,
 *          twenty-three men won it and roughly four hundred wear the ring.
 *
 *          AND IT MUST OUTRANK THE RING SPECIFICALLY, because it IMPLIES the
 *          ring: a Finals MVP is on the winning team by definition, so every
 *          card that holds this holds CHAMP too. If those two were the other
 *          way round, a capped row would drop the rarer mark and keep the one
 *          it is entailed by — printing the weaker half of the same fact. See
 *          MAX_CARD_AWARDS for why that is the drop order and not a coincidence.
 *
 *          ABOVE DPOY because it is the other award named Most Valuable Player
 *          and is decided on the games that decide the title, and BELOW MVP
 *          because a season outranks a series. That last one is the only line
 *          here anybody could reasonably want drawn elsewhere.
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
 * ── `token` — WHEN THE SITE'S SPELLING CANNOT BE THE CODE ───────────────────
 *
 * THE CODE IS THE JOIN KEY BY DEFAULT: for the seven codes that come out of
 * Basketball-Reference's column as bare initialisms, `code` IS the site's
 * string, because that side of the join is not ours to rename.
 *
 * `Finals MVP` breaks that, and it is the reason this field exists. It is the
 * site's spelling, so the join must use it; and it contains a SPACE, so it is a
 * poor code (`byCode` keys, run-report columns, anything a reader types) and an
 * impossible filename stem. `token` splits the two jobs: the row joins on
 * `token ?? code` and is known everywhere else by `FMVP`.
 *
 * Which also makes the join DECLARED. Before this, "the code equals the site's
 * token" was a convention held up by nothing; now the one row that departs from
 * it says so in the row, and `awardsEarned` reads `token ?? code` rather than
 * assuming.
 *
 * ── `file` — WHEN THE FILENAME IS NOT THE CODE EITHER ───────────────────────
 *
 * The CODE IS THE FILENAME BY DEFAULT — `/awards/{file ?? code}` under public/,
 * see awardImagePath — and `file` is the exception. It is needed exactly when
 * nothing external dictates the spelling, because then the user's own saved
 * filename is the only fact in play and renaming a file in a directory he is
 * actively curating would be the tail wagging the dog. Two rows use it:
 *
 *   CHAMP  is not in that column at all and Basketball-Reference has no token
 *          for it, so there is no external spelling to honour. He saved
 *          `public/awards/LarryOBrien.jpg`, named for the trophy.
 *
 *   FMVP   has an external TOKEN but no external FILENAME — `token` is what
 *          carries the site's spelling now, which frees the stem completely. He
 *          saved `Finals_MVP`, so that is the stem.
 *
 * The five plain rows need neither field, and that is the shape to keep: a row
 * declares only the ways in which it is unusual.
 *
 * ── `postSeason: true` — WHICH TABLE THIS CODE MAY COME OUT OF ──────────────
 *
 * The third flag, and the narrowest. `selection` says a code is HELD rather
 * than WON; `external` says it is not in the awards column at all; `postSeason`
 * says it is in the awards column of the PLAYOFF table and only there.
 *
 * It exists because the generator now reads two tables, and the whole risk of
 * doing so is the playoff column contributing something it should not. The flag
 * makes that a rule instead of an observation: `postSeasonAwardsEarned` keeps
 * only rows carrying it, so no string in `advanced_post` can produce an
 * All-Star selection or a regular-season trophy — not today, when that column
 * holds nothing but `Finals MVP-1`, and not if the site starts repeating the
 * regular-season cell there tomorrow.
 *
 * Deliberately NOT the mirror rule. `awardsEarned` does not exclude postSeason
 * rows, so a `Finals MVP-1` that ever appeared in the REGULAR table would still
 * mark the card. That direction is harmless — it is the same man with the same
 * trophy — and refusing it would mean losing a real mark to a site
 * reorganisation. The guard is one-directional because only one direction is
 * dangerous.
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
  {
    code: 'FMVP',
    name: 'Finals MVP',
    // Basketball-Reference's own spelling, space and all — see `token` above.
    token: 'Finals MVP',
    file: 'Finals_MVP',
    postSeason: true,
  },
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
 * MATCHED ON `token ?? code`, which is the row's side of the join and the whole
 * of what `token` is for: `FMVP` is what this build calls the mark and
 * `Finals MVP` is what Basketball-Reference calls it, and only one of those two
 * strings is ever compared against a scraped cell.
 *
 * AND THE COMPOUND TOKEN STILL CANNOT BECOME AN MVP. `Finals MVP-1` parses as
 * the single code `Finals MVP` — the space is inside the code, `codesIn` splits
 * on `,` alone, and `MVP` is not a token anywhere in that string. So
 * `awardsEarned('MVP-4,Finals MVP-1')` is `['FMVP']`: the Finals MVP he won,
 * and not the regular-season MVP he came fourth in.
 */
export function awardsEarned(raw) {
  const won = new Set(awardsWon(raw));
  const held = new Set(selectionsIn(raw));
  return AWARDS.filter(a => {
    if (a.external) return false;
    const key = a.token ?? a.code;
    return a.selection ? held.has(key) : won.has(key);
  }).map(a => a.code);
}

/**
 * The DECLARED codes a PLAYOFF awards string earns, in priority order.
 *
 * The `advanced_post` table's column, and the one door it is allowed through.
 * `postSeason: true` is the filter — see AWARDS — so today this can return
 * `['FMVP']` or nothing at all, and there is no string it can be handed that
 * produces a regular-season trophy or an All-Star selection.
 *
 * THAT IS THE POINT OF HAVING A SECOND FUNCTION rather than an argument to the
 * first. The generator reads two tables and must not confuse them; two named
 * doors make the call site say which table it is holding, where a boolean would
 * have made it say `true`.
 *
 * Built on `awardsEarned` rather than beside it, so the `-1` rule, the
 * `token` join and the `external` guard are all the SAME code — a Finals MVP
 * still has to have finished first, and `postSeason` narrows what may be
 * returned without loosening anything about how it is read.
 */
export function postSeasonAwardsEarned(raw) {
  return awardsEarned(raw).filter(code => getAward(code)?.postSeason === true);
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
 * ── AND THE FOURTH MARK IS NOW SPENT ───────────────────────────────────────
 *
 * NOTHING IS DROPPED TODAY. Measured on the generated file rather than argued
 * (`mostHeld` in card-awards.json):
 *
 *        2026-27       most held 3   40 of 61 marked   4 with more than one
 *        super-season  most held 4   51 of 82 marked  13 with more than one
 *        rookie        most held 1   17 of 76 marked   0 with more than one
 *
 * THE FOUR IS SHAI GILGEOUS-ALEXANDER'S 2024-25 SUPER SEASON CARD, and it is
 * the exact card this number was raised past three for. `MVP-1,DPOY-10,
 * CPOY-8,AS,NBA1` in the regular-season column, `Finals MVP-1` in the playoff
 * one, and Oklahoma City's title: MVP + FMVP + CHAMP + AS. Before Finals MVP
 * was a mark he held three of those and the cap sat one clear; admitting the
 * mark spent that headroom on the first card that could use it, which is what
 * headroom is for and is also why `capped` is worth counting every run.
 *
 * A FIFTH IS REACHABLE and would be dropped. It needs a man who won two
 * regular-season trophies, the Finals MVP, the title and an All-Star place in
 * one season — nobody has, and if he ever does the All-Star nod is what goes.
 *
 * `pickAwards` drops from the BOTTOM of the priority order when it must, so the
 * mark that goes is always the least of them — All-Star first, then the ring,
 * and never a trophy. That ordering is the reason a fifth mark could not cost a
 * card its MVP, and the reason a capped Finals MVP keeps the trophy and drops
 * the ring it implies rather than the other way round. See AWARDS.
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
 * THE STEM IS THE ROW'S `file`, WHICH DEFAULTS TO ITS CODE. For the six codes
 * Basketball-Reference names as bare initialisms, those are the same string and
 * the stem is not negotiable: the All-Star mark is `AS.…`, and `All-Star.webp`
 * is a file nothing asks for.
 *
 * TWO ROWS DECLARE A `file` INSTEAD, and both may because no external source
 * dictates their FILENAME: CHAMP (`LarryOBrien`), which is in no column at all,
 * and FMVP (`Finals_MVP`), whose site spelling lives in `token` and could not
 * be a filename anyway — `Finals MVP.png` would put a space in a URL. Both are
 * what the user actually saved. See AWARDS.
 *
 * A card whose art is missing under every accepted format falls back to the
 * lettered chip — see AwardMark in CardTemplate.jsx.
 */
export function awardImagePath(code, league = 'NBA') {
  const award = getAward(code);
  if (!award) return null;
  // A WNBA CARD NEVER SHOWS NBA HARDWARE. This used to fall back to the shared
  // file on the argument that "a card showing the wrong league's trophy still
  // reads better than a lettered chip where a trophy belongs". The user's call
  // reverses it: "for WNBA awards we don't have trophy photos for, just add
  // badges as placeholders."
  //
  // And that is the better rule, because the two objects are genuinely
  // different — the WNBA championship trophy is not a recoloured Larry O'Brien
  // and its MVP trophy is not the Michael Jordan Trophy. A card that shows the
  // NBA's is not a card waiting for art; it is a card making a false claim,
  // and it looks finished while doing so. The lettered chip looks unfinished,
  // which is exactly what it is.
  //
  // So the WNBA gets ONE candidate and no fallback. AssetImage's walk exhausts
  // and lands on the chip, which prints the code the user named the award by.
  // Dropping a file into public/awards/wnba/ is still the whole job.
  //
  // The league folder names by CODE, not by `file`. `file` exists only to
  // honour the filenames the user had already saved for the NBA set, and there
  // is no such history here — `/awards/wnba/LarryOBrien.png` would be an
  // actively wrong name for a trophy that is not the Larry O'Brien.
  if (league === 'WNBA') return [`/awards/wnba/${award.code}.png`];
  return `/awards/${award.file ?? award.code}.png`;
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
