// src/game/coinRewards.js — Coin reward calculator with NBA milestone bonuses

const MILESTONES = [
  {
    id: 'triple_double',
    name: 'Triple-Double',
    coins: 50,
    check: (stats) => stats.some(ps => (ps.pts || 0) >= 10 && (ps.reb || 0) >= 10 && (ps.ast || 0) >= 10),
  },
  {
    id: 'fifty_pts',
    name: '50+ pts (single player)',
    coins: 25,
    check: (stats) => stats.some(ps => (ps.pts || 0) >= 50),
  },
  {
    id: 'kobe_81',
    name: '81+ pts (single player — Kobe)',
    coins: 75,
    check: (stats) => stats.some(ps => (ps.pts || 0) >= 81),
  },
  {
    id: 'wilt_100',
    name: '100+ pts (single player — Wilt)',
    coins: 100,
    check: (stats) => stats.some(ps => (ps.pts || 0) >= 100),
  },
];

// Special milestone: 83+ pts with one player = free Bam card (not coins)
const BAM_MILESTONE = {
  id: 'bam_83',
  name: '83+ pts (single player) — Free Bam Adebayo!',
  check: (stats) => stats.some(ps => (ps.pts || 0) >= 83),
  cardReward: 'Bam_Adebayo',
};

export function calculateRewards(game, isWinner, dailyMilestoneCoinsUsed = 0, isPvp = false) {
  const DAILY_MILESTONE_CAP = 200;
  let coins = 0;
  const breakdown = [];

  // Base game completion
  coins += 50;
  breakdown.push({ label: 'Game Completed', coins: 50 });

  // Win bonus (PvP wins are worth more)
  if (isWinner) {
    const winBonus = isPvp ? 50 : 25;
    coins += winBonus;
    breakdown.push({ label: isPvp ? 'PvP Victory' : 'Victory Bonus', coins: winBonus });
  }

  // Milestone checks (check both teams since self-play is valid)
  const teamScores = [game.teamA.score, game.teamB.score];
  let milestoneCoins = 0;

  for (const m of MILESTONES) {
    const hit = teamScores.some((score, i) => {
      const stats = i === 0 ? game.teamA.stats : game.teamB.stats;
      return m.check(stats, score);
    });
    if (hit) {
      const available = DAILY_MILESTONE_CAP - dailyMilestoneCoinsUsed - milestoneCoins;
      const award = Math.min(m.coins, Math.max(0, available));
      if (award > 0) {
        milestoneCoins += award;
        coins += award;
        breakdown.push({ label: m.name, coins: award });
      }
    }
  }

  // Bam check (separate from coin cap)
  let bamReward = false;
  for (let i = 0; i < 2; i++) {
    const stats = i === 0 ? game.teamA.stats : game.teamB.stats;
    if (BAM_MILESTONE.check(stats)) {
      bamReward = true;
      breakdown.push({ label: BAM_MILESTONE.name, coins: 0, special: true });
      break;
    }
  }

  return { coins, milestoneCoins, breakdown, bamReward, bamCardId: 'Bam_Adebayo' };
}

export { MILESTONES, BAM_MILESTONE };
