# Throwbacks: the look (2026-09-10)

Throwbacks is the Free Agents catch-all. A requested season that is not a rookie year, a best season or a playoff run lands here (see `2026-09-10-free-agents-design.md`). There are two sets, `throwbacks` (NBA) and `wnba-throwbacks`. Until now neither could be built, because the look was not decided.

## Decided

- **One look for every Throwbacks card, in both leagues and every decade.** It is the 1990s mockup: teal brush strokes and purple zigzag scribbles, in the loud cup colors. The user: "keep the loud colors, it's fine."
- **In the team's colors (2026-09-11).** The user: "make the teal part auto-adapt to each team's secondary color, and the squiggle be the accent."
  - The brush is the team's secondary and the scribble its accent. The frame and the band edge sweep from one to the other.
  - Each color is nudged by `readableOn` against what it sits on: the brush against the field (or the band, for the band's patches), and the scribble against the brush. So a team whose accent is its secondary (Lakers gold, Cavs gold) gets a darker scribble, not a vanishing one.
  - The cup's teal and purple remain the fallback.
- **Considered and not taken:** a different look per decade. The six mockups covered the 1970s (rainbow stripes and arcs), 1980s (Memphis), 1990s, 2000s (chrome and the silhouette ad), 2010s (flat long shadows) and 2020s (aura and glass). The user liked the 70s and 90s but asked for one uniform look.
- **Where the look goes:**
  - the frame, as a teal-to-purple sweep;
  - the band's accent edge;
  - the two corner ornaments, drawn instead of the dotted chevrons;
  - the band's two open patches, left of the league mark and between SPEED and POWER.

  The field stays the team's color, and nothing is drawn behind a number or a name.
- **The pill reads THROWBACK,** in the team's accent like the other set pills, and the season line prints.
- **Static SVG built from shapes,** so the batch export screenshots it exactly. Filter ids are unique per card.
- **Packs and goals:** the set has no completion goal (decided earlier). It joins the specials in packs by rarity.
- **Building:** the Studio can build Throwbacks requests once this ships. Marissa Coleman's 2010 WNBA request is the first one waiting.
