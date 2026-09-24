"""THE ART FOLLOWS THE SUPER SEASON VALUE PICK (2026-09-24).

    python scripts/studio/superSeasonArt.py            # report only
    python scripts/studio/superSeasonArt.py --apply    # copy / move the files

Run after the Super Season generators (generateSpecialSets.js,
wnba/generateWnbaLegends.js) and generateCuratedCards.js. Three moves, in this
order, each idempotent, then the dormant list:

  THE RULE (the user, 2026-09-24). A photo belongs to the season it was taken
  for — "Whatever card/season was created/exported/existed first keeps the
  picture", "New cards = new photos" — EXCEPT inside one logo era: "any photos
  that were moved to throwbacks but still use the same logo era can be moved
  back to Super Season." Same logo era = the same era-coded team (MIN11,
  HOU20, CHI: the generators write the era into the code), so a Lynx 2014
  photo serves the 2013 Super Season and a 2001-02 Jazz photo does not serve
  1994-95.

  1. RETIRED -> THROWBACK, ACROSS ERAS. A Throwback that was a Super Season
     (`demotedFrom` in the demoted files) gets a copy of the Super Season's
     photo and crop under its own id when the new Super Season is in ANOTHER
     logo era (or left the set, or is a reward now). In the same era the
     photo stays with the Super Season and nothing is copied.
  2. ABSORBED -> SUPER SEASON. A Super Season card that absorbed a requested or
     curated card of its season (`migratedFrom`) takes that card's photo and
     crop: it is the same season, already photographed for it.
  3. ONE PHOTO, ONE CARD. Same logo era: the Super Season holds the photo — a
     Throwback's is MOVED back to a bare Super Season, and a Throwback's exact
     copy of the Super Season's is removed. Another era: the Throwback keeps
     it and the Super Season's exact copy is removed, so it shows placeholder
     art and the Photo Hunt lists it. Only byte-identical copies are ever
     deleted: a photo dropped on either card since is never touched.

  Then the DORMANT list (scripts/studio/dormantThrowbacks.mjs): a Throwback
  left without a photo sits out of every pack until someone requests it
  through Free Agents ("Throwbacks WITHOUT photos should stay dormant").

Crops files keep their indent (2) and LF. A crops file with the user's own
uncommitted edits is still edited in place (only new keys are added), and the
report says which files those are so the commit can leave them out.
"""
import glob
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
ART = os.path.join(ROOT, 'card-art', 'sets')
GEN = os.path.join(ROOT, 'card-data', 'generated')
APPLY = '--apply' in sys.argv


def load(p, default=None):
    if not os.path.exists(p):
        return default
    with open(p, encoding='utf8') as f:
        return json.load(f)


def save(p, d):
    with open(p, 'w', encoding='utf8', newline='\n') as f:
        f.write(json.dumps(d, indent=2, ensure_ascii=False) + '\n')


def photos(set_id, stem):
    return [p for p in glob.glob(os.path.join(ART, set_id, 'photos', stem + '.*'))
            if os.path.splitext(p)[0].endswith(stem)]


crops_cache = {}


def crops(set_id):
    if set_id not in crops_cache:
        crops_cache[set_id] = load(os.path.join(ART, set_id, 'crops.json'), {}) or {}
    return crops_cache[set_id]


dirty_crops = set()


def copy_art(src_set, src_id, dst_set, dst_id, log):
    done = False
    for src in photos(src_set, src_id):
        dst = os.path.join(ART, dst_set, 'photos', dst_id + os.path.splitext(src)[1])
        if photos(dst_set, dst_id):
            break
        log.append(f'  photo {src_set}/{src_id} -> {dst_set}/{dst_id}')
        if APPLY:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(src, dst)
        done = True
        break
    c_src, c_dst = crops(src_set), crops(dst_set)
    if src_id in c_src and dst_id not in c_dst:
        c_dst[dst_id] = c_src[src_id]
        dirty_crops.add(dst_set)
        log.append(f'  crop  {src_set}/{src_id} -> {dst_set}/{dst_id}')
    return done


def same_bytes(a, b):
    try:
        if os.path.getsize(a) != os.path.getsize(b):
            return False
        with open(a, 'rb') as fa, open(b, 'rb') as fb:
            return fa.read() == fb.read()
    except OSError:
        return False


def same_era(a, b):
    # The generators write era-resolved team codes (MIN11, HOU20, UTA04): the
    # same code is the same logo era.
    return bool(a.get('team')) and str(a.get('team')) == str(b.get('team'))


def move_art(src_set, src_id, dst_set, dst_id, log):
    """Photo and crop from one card to another; the source is left bare."""
    moved = False
    for src in photos(src_set, src_id):
        dst = os.path.join(ART, dst_set, 'photos', dst_id + os.path.splitext(src)[1])
        log.append(f'  photo {src_set}/{src_id} -> {dst_set}/{dst_id} (moved back)')
        if APPLY:
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.move(src, dst)
        moved = True
        break
    c_src, c_dst = crops(src_set), crops(dst_set)
    if src_id in c_src:
        if dst_id not in c_dst:
            c_dst[dst_id] = c_src[src_id]
            dirty_crops.add(dst_set)
        c_src.pop(src_id)
        dirty_crops.add(src_set)
    return moved


def remove_art(set_id, card_id, files):
    if APPLY:
        for p in files:
            os.remove(p)
    if card_id in crops(set_id):
        crops(set_id).pop(card_id)
        dirty_crops.add(set_id)


def cards_of(name):
    body = load(os.path.join(GEN, name), {}) or {}
    return body.get('cards', []) if isinstance(body, dict) else body


def team_code(team):
    # Franchise codes carry an era suffix (MIN11, CLE04); the franchise is the letters.
    return ''.join(ch for ch in str(team or '') if ch.isalpha())


def main():
    log = []
    ss_cards = {s: {c['id']: c for c in cards_of(f'cards-{s}.json')} for s in ('super-season', 'wnba-super-season')}
    # A Super Season that moved into a reward shows as the reward, with its own photo.
    in_reward = {(c['migratedFrom']['set'], c['migratedFrom']['id'])
                 for f in ('cards-team-rewards.json', 'cards-set-rewards.json',
                           'cards-wnba-team-rewards.json', 'cards-wnba-set-rewards.json')
                 for c in cards_of(f) if c.get('migratedFrom')}
    retired = []  # (ss_set, the Super Season now or None, the Throwback, its set)
    for demoted_file in ('demoted-super-seasons.json', 'demoted-wnba-super-seasons.json'):
        for card in cards_of(demoted_file):
            src = card.get('demotedFrom')
            if not src:
                continue
            tb_set = card.get('set') or ('wnba-throwbacks' if src['set'].startswith('wnba') else 'throwbacks')
            ss = ss_cards.get(src['set'], {}).get(src['id'])
            shown = ss is not None and not ss.get('migratedFrom') and (src['set'], src['id']) not in in_reward
            retired.append((src['set'], ss if shown else None, card, tb_set))
    # 1. retired -> throwback, across logo eras only
    for ss_set, ss, tb, tb_set in retired:
        if ss is not None and same_era(ss, tb):
            continue
        copy_art(ss_set, tb['demotedFrom']['id'], tb_set, tb['id'], log)
    # 2. absorbed -> super season (after step 1 has saved the old face)
    for ss_set in ('super-season', 'wnba-super-season'):
        for card in cards_of(f'cards-{ss_set}.json'):
            src = card.get('migratedFrom')
            if not src:
                continue
            had = photos(ss_set, card['id'])
            if had and APPLY:
                for p in had:
                    os.remove(p)
            crops(ss_set).pop(card['id'], None)
            dirty_crops.add(ss_set)
            copy_art(src['set'], src['id'], ss_set, card['id'], log)
            log.append(f'  absorbed {ss_set}/{card["id"]} now wears {src["set"]}/{src["id"]}\'s photo')
    # 3. one photo, one card: the Super Season in its own logo era, else the Throwback
    hunt, back = [], []
    for ss_set, ss, tb, tb_set in retired:
        if ss is None:
            continue
        ss_ph, tb_ph = photos(ss_set, ss['id']), photos(tb_set, tb['id'])
        label = f'{ss["name"]} {ss.get("seasonLabel", ss.get("season"))} ({ss.get("team")})'
        identical = any(same_bytes(a, b) for a in ss_ph for b in tb_ph)
        if same_era(ss, tb):
            if tb_ph and not ss_ph:
                move_art(tb_set, tb['id'], ss_set, ss['id'], log)
                back.append(f'{label} <- {tb_set}/{tb["id"]}')
            elif identical:
                remove_art(tb_set, tb['id'], tb_ph)
                back.append(f'{label} keeps it; {tb_set}/{tb["id"]}\'s copy removed')
        elif identical:
            remove_art(ss_set, ss['id'], ss_ph)
            hunt.append(f'{label}; the photo stays on {tb_set}/{tb["id"]} ({tb.get("team")})')
    if APPLY:
        for set_id in dirty_crops:
            save(os.path.join(ART, set_id, 'crops.json'), crops(set_id))
    print('\n'.join(log) or '  nothing to copy')
    print(f'\n{len(back)} Super Season(s) hold their photo again (same logo era):')
    for b in back:
        print('  ' + b)
    print(f'\n{len(hunt)} Super Season(s) moved logo era and need a new photo (Photo Hunt):')
    for h in hunt:
        print('  ' + h)
    if APPLY:
        # The Throwbacks left without a photo go dormant (dormantThrowbacks.mjs).
        subprocess.run(['node', os.path.join(ROOT, 'scripts', 'studio', 'dormantThrowbacks.mjs')], cwd=ROOT)
    try:
        dirty = subprocess.run(['git', 'status', '--short', '--', 'card-art'], cwd=ROOT, capture_output=True, text=True).stdout
        user = [l for l in dirty.splitlines() if l.startswith(' M') and 'crops.json' in l]
        if user:
            print('\nCrops files with uncommitted changes (yours or this run\'s) — commit only this run\'s:')
            print('\n'.join('  ' + l for l in user))
    except OSError:
        pass
    if not APPLY:
        print('\n(report only — run with --apply to write)')


if __name__ == '__main__':
    main()
