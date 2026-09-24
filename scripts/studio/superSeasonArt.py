"""THE ART FOLLOWS THE SUPER SEASON VALUE PICK (2026-09-24).

    python scripts/studio/superSeasonArt.py            # report only
    python scripts/studio/superSeasonArt.py --apply    # copy / move the files

Run after the Super Season generators (generateSpecialSets.js,
wnba/generateWnbaLegends.js) and generateCuratedCards.js. Three moves, in this
order, each idempotent:

  1. RETIRED -> THROWBACK. Every Throwback that was a Super Season
     (`demotedFrom` in the demoted files) gets a copy of the Super Season's
     photo and crop under its own id, so the card someone owned keeps its face.
     The Super Season photo is COPIED, never moved.
  2. ABSORBED -> SUPER SEASON. A Super Season card that absorbed a requested or
     curated card of its season (`migratedFrom`) takes that card's photo and
     crop: it is the same season, already photographed for it.
  3. THE NEW SEASON GETS A NEW PHOTO. A Super Season whose season moved
     loses the old photo — it is safe in the Throwback copy from step 1 — and
     shows placeholder art until the Photo Hunt finds its own. The user's rule
     (2026-09-24), after seeing Maya Moore's 2013 Super Season and 2014
     Throwback on one image: "Whatever card/season was created/exported/
     existed first keeps the picture", and "New cards = new photos" — no
     borrowing a photo from another set either. This used to apply only when
     the franchise changed, which left 62 same-team pairs showing one photo.
     Only the COPY is removed (same bytes as the Throwback's photo): a photo
     dropped on the card since, taken for its new season, is never touched.

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


def cards_of(name):
    body = load(os.path.join(GEN, name), {}) or {}
    return body.get('cards', []) if isinstance(body, dict) else body


def team_code(team):
    # Franchise codes carry an era suffix (MIN11, CLE04); the franchise is the letters.
    return ''.join(ch for ch in str(team or '') if ch.isalpha())


def main():
    log = []
    # 1. retired -> throwback
    for demoted_file in ('demoted-super-seasons.json', 'demoted-wnba-super-seasons.json'):
        for card in cards_of(demoted_file):
            src = card.get('demotedFrom')
            if not src:
                continue
            copy_art(src['set'], src['id'], card.get('set') or 'throwbacks', card['id'], log)
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
    # 3. the new season loses the old photo (the retired season keeps it)
    retired = {}
    for demoted_file in ('demoted-super-seasons.json', 'demoted-wnba-super-seasons.json'):
        for card in cards_of(demoted_file):
            src = card.get('demotedFrom')
            if src:
                retired.setdefault((src['set'], src['id']), []).append(card)
    hunt = []
    for ss_set in ('super-season', 'wnba-super-season'):
        for card in cards_of(f'cards-{ss_set}.json'):
            if card.get('migratedFrom'):
                continue
            olds = retired.get((ss_set, card['id']), [])
            if not olds:
                continue
            had = photos(ss_set, card['id'])
            if not had:
                continue
            default_tb = 'wnba-throwbacks' if ss_set.startswith('wnba') else 'throwbacks'
            copy_of = [old for old in olds
                       if any(same_bytes(h, q) for h in had for q in photos(old.get('set') or default_tb, old['id']))]
            if not copy_of:
                continue  # its own photo, taken for this season: keep it
            old = copy_of[0]
            moved = '' if team_code(old.get('team')) == team_code(card.get('team')) else f'; moved from {old.get("team")}'
            hunt.append(f'{card["name"]} {card.get("seasonLabel", card.get("season"))} ({card.get("team")}{moved}; '
                        f'the photo stays on {old.get("set") or default_tb}/{old["id"]})')
            if APPLY:
                for p in had:
                    os.remove(p)
            crops(ss_set).pop(card['id'], None)
            dirty_crops.add(ss_set)
    if APPLY:
        for set_id in dirty_crops:
            save(os.path.join(ART, set_id, 'crops.json'), crops(set_id))
    print('\n'.join(log) or '  nothing to copy')
    print(f'\n{len(hunt)} Super Season(s) moved season and need a new photo (Photo Hunt):')
    for h in hunt:
        print('  ' + h)
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
