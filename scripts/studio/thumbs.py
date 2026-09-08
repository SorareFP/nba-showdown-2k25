"""Thumbnails for every card face — the tile-sized copies the board actually shows.

    python scripts/studio/thumbs.py            every set under public/cards, plus strats
    python scripts/studio/thumbs.py --set 2026-27 --set strats
    python scripts/studio/thumbs.py --force    rebuild even when the thumb is newer

WHY. A face is a full-resolution PNG of 0.5–0.9 MB; the lineup screen shows
twenty of them at 130 px wide, which was 14 MB for one screen and, on a phone,
several seconds of blank tiles (the user, 2026-09-08: "no photos"). A 420-px
WebP of the same face is ~45 KB and still sharp at 2× on a 210-px tile. The
lightbox and the pack reveal keep the full PNG; everything tile-sized reads
public/cards/thumbs/{set}/{id}.webp through getPlayerThumbUrl /
getStratThumbPath in src/game/cardImages.js, falling back to the PNG when a
thumb is missing — so a freshly exported face still shows before this runs.

Run after `npm run export:cards` (export.js calls it for the sets it wrote).
Up to date thumbs are skipped by mtime, so a full run after a partial export
only touches what changed.
"""
import argparse
import os
import sys
import time
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
CARDS = ROOT / 'public' / 'cards'
OUT = CARDS / 'thumbs'
WIDTH = 420
QUALITY = 80
SKIP_DIRS = {'thumbs', 'players'}   # players/ is the legacy flat path; the sets are the source


def sets_on_disk():
    return sorted(p.name for p in CARDS.iterdir() if p.is_dir() and p.name not in SKIP_DIRS)


def build(set_name, force=False):
    src_dir = CARDS / set_name
    dst_dir = OUT / set_name
    dst_dir.mkdir(parents=True, exist_ok=True)
    made = skipped = 0
    for png in sorted(src_dir.glob('*.png')):
        dst = dst_dir / (png.stem + '.webp')
        if not force and dst.exists() and dst.stat().st_mtime >= png.stat().st_mtime:
            skipped += 1
            continue
        with Image.open(png) as im:
            im = im.convert('RGB')
            h = round(im.height * WIDTH / im.width)
            im = im.resize((WIDTH, h), Image.LANCZOS)
            im.save(dst, 'WEBP', quality=QUALITY, method=4)
        made += 1
    # A thumb whose face is gone is stale: drop it, the way --prune drops faces.
    pruned = 0
    keep = {p.stem for p in src_dir.glob('*.png')}
    for webp in dst_dir.glob('*.webp'):
        if webp.stem not in keep:
            webp.unlink()
            pruned += 1
    return made, skipped, pruned


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--set', action='append', dest='sets')
    ap.add_argument('--force', action='store_true')
    args = ap.parse_args()
    sets = args.sets or sets_on_disk()
    t0 = time.time()
    total = 0
    for s in sets:
        if not (CARDS / s).is_dir():
            print(f'  {s}: no such set under public/cards', file=sys.stderr)
            continue
        made, skipped, pruned = build(s, args.force)
        total += made
        print(f'  {s}: {made} written, {skipped} up to date' + (f', {pruned} pruned' if pruned else ''))
    size = sum(p.stat().st_size for p in OUT.rglob('*.webp')) / 1048576
    print(f'thumbs: {total} written in {time.time() - t0:.0f}s; {size:.1f} MB on disk')


if __name__ == '__main__':
    main()
