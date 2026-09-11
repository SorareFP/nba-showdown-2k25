// THE DYNASTY MARKET — what a player asks, what he takes, and who he is.
//
// The user (2026-09-11): "The salary on the card is gonna determine … how much
// you can sign a player for. Better players ask for more dynasty points while
// ten salary cards are just happy to be on the team. But maybe we randomly
// assign them personalities or something … to make the signing process more
// intriguing." The design is docs/plans/2026-09-11-dynasty-design.md.
//
// ── DYNASTY POINTS ARE A PAYROLL ────────────────────────────────────────────
//
// A contract is DP per season for some years, and every season's contracts
// together must fit under the cap. The scale is the printed cap turned into
// DP: $5,500 of salary is 100 DP, so a card's fair value is its salary / 55.
//
// ── A NEGOTIATION IS ARITHMETIC, NOT DICE ───────────────────────────────────
//
// Every player carries a FLOOR — the least he will sign for, from this team,
// for this many years, on this day of the market — and an ASK above it. The
// floor is never shown. An offer at or over it signs; under it, he says how
// far apart you are and his ask comes down, until his patience runs out.
// Nothing here rolls: the personality is dealt once, when the dynasty is
// made, so a reload cannot re-roll a player into a better mood.

/** The payroll cap, in DP per season. */
export const CAP_DP = 100;
/** Your own players (Bird rights) and your own draft picks may take you this far over it. */
export const APRON_DP = 115;
/** The minimum deal — always signable, up to the apron. */
export const MIN_DP = 1;
/** Printed salary per Dynasty Point: the $5,500 cap is 100 DP. */
export const DP_PER_SALARY = 55;
/** A card this cheap is always Happy to Be Here. */
export const HAPPY_MAX_SALARY = 150;
export const CONTRACT_YEARS = { min: 1, max: 4 };
/** A draft pick signs for three-quarters of his value, for three seasons. */
export const ROOKIE_SCALE = { share: 0.75, years: 3 };
/** Free agency runs this many days; every floor drops 10% a day. */
export const FA_DAYS = 3;
export const DAY_DISCOUNT = 0.1;
/** The market after free agency closes: whoever is left, at the last price. */
export const LEFTOVER_DAY = FA_DAYS + 1;

/** A card's fair value in DP. */
export function fairDp(card) {
  return Math.max(MIN_DP, Math.round((card?.salary ?? 0) / DP_PER_SALARY));
}

/**
 * The personalities. `premium` scales his value, `give` is how far under his
 * opening ask his floor sits, `patience` is how many rejections he takes,
 * `years` the length he wants and `yearCost` what each year off it adds.
 */
export const PERSONALITIES = {
  loyal: {
    id: 'loyal', label: 'Loyal', icon: '🤝',
    blurb: 'Takes 20% less to stay with the team he played for.',
    premium: 1, give: 0.85, patience: 3, years: 3, yearCost: 0.06,
  },
  ring: {
    id: 'ring', label: 'Ring Chaser', icon: '💍',
    blurb: 'Cheaper for a contender, dearer for a team in the lottery.',
    premium: 1, give: 0.85, patience: 3, years: 2, yearCost: 0.06,
  },
  money: {
    id: 'money', label: 'Mercenary', icon: '💰',
    blurb: 'Only the number matters — and it is high. Little give, little patience.',
    premium: 1.15, give: 0.93, patience: 2, years: 2, yearCost: 0.02,
  },
  security: {
    id: 'security', label: 'Security First', icon: '🛡️',
    blurb: 'Wants every year you can give him; each one short costs you.',
    premium: 1, give: 0.85, patience: 3, years: 4, yearCost: 0.12, direction: 'short',
  },
  bet: {
    id: 'bet', label: 'Bets on Himself', icon: '🎲',
    blurb: 'Wants one year, to cash in next time; each extra year costs you.',
    premium: 1, give: 0.85, patience: 3, years: 1, yearCost: 0.12, direction: 'long',
  },
  easy: {
    id: 'easy', label: 'Easygoing', icon: '😎',
    blurb: 'A little under his value and wide open to a deal.',
    premium: 0.95, give: 0.78, patience: 4, years: 2, yearCost: 0.04,
  },
  happy: {
    id: 'happy', label: 'Happy to Be Here', icon: '😊',
    blurb: 'A minimum deal and a jersey. Any length, any team.',
    premium: 0, give: 1, patience: 99, years: 1, yearCost: 0, flat: true,
  },
};

/** How often each is dealt; Happy to Be Here is decided by salary, not dealt. */
const DEALT = [['loyal', 20], ['ring', 15], ['money', 15], ['security', 15], ['bet', 15], ['easy', 20]];

export const personality = id => PERSONALITIES[id] ?? PERSONALITIES.easy;

/** Deal a player his personality. */
export function dealPersonality(card, rng = Math.random) {
  if ((card?.salary ?? 0) <= HAPPY_MAX_SALARY) return 'happy';
  const total = DEALT.reduce((t, [, w]) => t + w, 0);
  let r = rng() * total;
  for (const [id, w] of DEALT) {
    r -= w;
    if (r < 0) return id;
  }
  return DEALT[DEALT.length - 1][0];
}

export const preferredYears = pid => personality(pid).years;

/** What a contract length off his preference adds to his price. */
export function yearFactor(pid, years) {
  const p = personality(pid);
  const diff = years - p.years;
  if (p.direction === 'short') return 1 + p.yearCost * Math.max(0, -diff);
  if (p.direction === 'long') return 1 + p.yearCost * Math.max(0, diff);
  return 1 + p.yearCost * Math.abs(diff);
}

export const TEAM_FACTORS = { loyalHome: 0.8, ringTitle: 0.75, ringPlayoffs: 0.88, ringLottery: 1.12, spurned: 1.25 };

/**
 * What the team asking does to his price. `ctx` is `{ teamId, lastTeamId,
 * standing, spurnedBy }` — standing being that team's last season,
 * `{ title, playoffs }`, or null before anyone has played.
 *
 * SPURNED: a player asks 25% more from the team that let him go this
 * offseason (renounced his rights, or waived him). Without it the dominant
 * move is to let every draftee walk and buy him back in free agency after the
 * market has cooled — which the first balance probe (2026-09-11) showed was
 * free, since nobody else had room to bid.
 */
export function teamFactor(pid, ctx = {}) {
  const spurned = ctx.spurnedBy && ctx.spurnedBy === ctx.teamId ? TEAM_FACTORS.spurned : 1;
  return spurned * personalFactor(pid, ctx);
}

function personalFactor(pid, ctx) {
  if (pid === 'loyal') return ctx.lastTeamId && ctx.lastTeamId === ctx.teamId ? TEAM_FACTORS.loyalHome : 1;
  if (pid === 'ring') {
    const s = ctx.standing;
    if (!s) return 1;
    if (s.title) return TEAM_FACTORS.ringTitle;
    if (s.playoffs) return TEAM_FACTORS.ringPlayoffs;
    return TEAM_FACTORS.ringLottery;
  }
  return 1;
}

/** The market cooling: a day of free agency takes 10% off every floor. */
export function dayFactor(day = 1) {
  const d = Math.min(Math.max(1, day), LEFTOVER_DAY);
  return 1 - DAY_DISCOUNT * (d - 1);
}

/**
 * AGE, in an aging dynasty (the user, 2026-09-11: "Retire + cheaper"): a
 * player's price falls 7% a year past 31, never below 40% of his value.
 * `ctx.age` is only set when the dynasty ages, so a ten-year one is untouched.
 */
export const AGE_PEAK = 31;
export const AGE_DECLINE = 0.07;
export const AGE_FLOOR = 0.4;
export function ageFactor(age) {
  if (!Number.isFinite(age) || age <= AGE_PEAK) return 1;
  return Math.max(AGE_FLOOR, 1 - AGE_DECLINE * (age - AGE_PEAK));
}

/** The least he signs for. Never shown to the player. */
export function floorFor(card, pid, ctx, years, day = 1) {
  const p = personality(pid);
  if (p.flat) return MIN_DP;
  const raw = fairDp(card) * p.premium * teamFactor(pid, ctx) * yearFactor(pid, years) * dayFactor(day) * ageFactor(ctx?.age);
  return Math.max(MIN_DP, Math.round(raw));
}

/** What he opens at, before any haggling. */
export function openingAsk(card, pid, ctx, years, day = 1) {
  const floor = floorFor(card, pid, ctx, years, day);
  return Math.max(floor, Math.ceil(floor / personality(pid).give));
}

/** His ask now: `progress` is how much of the gap to his floor the talks have closed. */
export function askFor(card, pid, ctx, years, { progress = 0, day = 1 } = {}) {
  const floor = floorFor(card, pid, ctx, years, day);
  const open = openingAsk(card, pid, ctx, years, day);
  return floor + Math.ceil((open - floor) * (1 - progress));
}

/** A fresh negotiation with him. */
export function newTalk(pid) {
  return { patience: personality(pid).patience, progress: 0, offers: 0, walked: false, mood: null };
}

/**
 * The smallest DP a season, at `years`, that beats a rival offer whose value
 * to him is `rivalRatio` (its DP over his floor for that team). Zero when no
 * one else is bidding.
 */
export function toBeat(card, pid, ctx, years, day, rivalRatio) {
  if (!rivalRatio) return 0;
  return Math.floor(floorFor(card, pid, ctx, years, day) * rivalRatio) + 1;
}

export const MOOD_TEXT = {
  signed: 'Deal.',
  close: 'Close — he wants a little more.',
  apart: 'Not there yet.',
  insulted: 'Insulted. That cost you his patience.',
  outbid: 'Another team is offering him a better deal.',
  walked: 'He is done talking to you.',
};

/**
 * Judge an offer. Returns `{ accepted, mood, talk }`, `talk` being the
 * negotiation after it. `rivalRatio` is the best rival offer's value to him
 * (0 for none): an offer has to clear his floor AND beat it.
 */
export function judgeOffer({ card, pid, ctx, offer, talk = null, day = 1, rivalRatio = 0 }) {
  const t = talk ?? newTalk(pid);
  const dp = Math.floor(offer?.dp ?? 0);
  const years = Math.floor(offer?.years ?? 0);
  if (dp < MIN_DP || years < CONTRACT_YEARS.min || years > CONTRACT_YEARS.max) {
    throw new Error(`dynasty: an offer is at least ${MIN_DP} DP for ${CONTRACT_YEARS.min}–${CONTRACT_YEARS.max} years`);
  }
  if (t.walked) return { accepted: false, mood: 'walked', talk: t };
  const floor = floorFor(card, pid, ctx, years, day);
  const offers = t.offers + 1;
  if (dp >= floor) {
    if (rivalRatio && dp / floor <= rivalRatio) {
      const patience = t.patience - 1;
      return { accepted: false, mood: 'outbid', talk: { ...t, offers, patience, walked: patience <= 0, mood: 'outbid' } };
    }
    return { accepted: true, mood: 'signed', talk: { ...t, offers, mood: 'signed' } };
  }
  const r = dp / floor;
  const mood = r >= 0.9 ? 'close' : r >= 0.7 ? 'apart' : 'insulted';
  const patience = t.patience - (mood === 'insulted' ? 2 : 1);
  // A serious offer brings his ask halfway down to the floor; an insult moves nothing.
  const progress = mood === 'insulted' ? t.progress : t.progress + (1 - t.progress) * 0.5;
  return { accepted: false, mood, talk: { ...t, offers, patience, progress, walked: patience <= 0, mood } };
}

/** A draft pick's contract: fixed, not negotiated. */
export function rookieScale(card) {
  return { dp: Math.max(MIN_DP, Math.round(fairDp(card) * ROOKIE_SCALE.share)), years: ROOKIE_SCALE.years };
}
