"""Is each Super Season card its player's most valuable season?

    python scripts/analysis/superSeasonVsOtherYears.py

Written 2026-09-23 for the user's report that Maya Moore's requested 2016 card
cost more than her Super Season (2014). For every NBA and WNBA Super Season
card, compares its salary with (a) every other BUILT card of the same player in
any set, exact, and (b) every uncarded season in the free-agent quote index,
whose estimates carry about $124 of noise (1 sd, quote-index calibration).
"""
import json, glob, os, collections

ROOT = os.path.join(os.path.dirname(__file__), '..', '..')
GEN = os.path.join(ROOT, 'card-data', 'generated')
NOISE = 124

def cards_of(path):
    try:
        d = json.load(open(path, encoding='utf-8'))
    except Exception:
        return []
    rows = d if isinstance(d, list) else d.get('cards')
    return rows if isinstance(rows, list) else []

built = collections.defaultdict(list)   # bbrefId -> [(set file, season, salary, name)]
for f in glob.glob(os.path.join(GEN, 'cards-*.json')):
    base = os.path.basename(f)
    for c in cards_of(f):
        if isinstance(c, dict) and c.get('bbrefId') and c.get('salary') is not None:
            built[c['bbrefId']].append((base, c.get('season'), c['salary'], c.get('name')))

quotes = collections.defaultdict(list)
q = json.load(open(os.path.join(GEN, 'quote-index.json'), encoding='utf-8'))
for bid, name, season, kind, team, sal, landing in q['rows']:
    if kind == 'r':
        quotes[bid].append((season, sal, landing))

for label, fname in [('NBA', 'cards-super-season.json'), ('WNBA', 'cards-wnba-super-season.json')]:
    ss = [c for c in cards_of(os.path.join(GEN, fname)) if c.get('bbrefId')]
    beaten_built, beaten_quote, within_noise = [], [], []
    for c in ss:
        bid, sal = c['bbrefId'], c['salary']
        others = [b for b in built[bid] if not (b[0] == fname and b[1] == c.get('season'))]
        top_built = max((b for b in others if b[1] != c.get('season')), key=lambda b: b[2], default=None)
        top_quote = max(quotes[bid], key=lambda r: r[1], default=None)
        if top_built and top_built[2] > sal:
            beaten_built.append((c['name'], c.get('season'), sal, top_built))
        if top_quote and top_quote[1] > sal + NOISE:
            beaten_quote.append((c['name'], c.get('season'), sal, top_quote))
        elif top_quote and top_quote[1] > sal:
            within_noise.append((c['name'], c.get('season'), sal, top_quote))
    print(f'\n== {label} Super Season: {len(ss)} cards ==')
    print(f'  another BUILT season of the player costs more: {len(beaten_built)}')
    for n, s, sal, b in sorted(beaten_built, key=lambda x: x[3][2] - x[2], reverse=True):
        print(f'    {n} {s} ${sal}  <  {b[1]} ${b[2]} ({b[0]})')
    print(f'  an uncarded season is QUOTED more than ${NOISE} above it: {len(beaten_quote)}')
    for n, s, sal, t in sorted(beaten_quote, key=lambda x: x[3][1] - x[2], reverse=True)[:40]:
        print(f'    {n} {s} ${sal}  <  {t[0]} quoted ${t[1]} (lands in {t[2]})')
    print(f'  quoted above it but inside the noise: {len(within_noise)}')
