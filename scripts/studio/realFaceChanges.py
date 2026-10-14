"""Which re-exported card faces REALLY changed, and which are render noise.

    python scripts/studio/realFaceChanges.py             list them
    python scripts/studio/realFaceChanges.py --restore   and check the noise back out of HEAD

WHY. A full export (`npm run export:cards -- --all --jobs 6`) is the only way
to catch a crop or a team colour edited without a new photo, which `--stale`
cannot see. But re-rendering an UNCHANGED card often changes its PNG's bytes:
the team logo resamples a few levels differently, now and then the whole card
shifts by a level or two (2026-10-14: 39 of the first 53 modified faces, not
one pixel off by more than 16 of 255). Committing those is megabytes of
nothing, so this sorts the modified faces first.

REAL means more than VISIBLE pixels moved by more than LEVEL. A new crop, a
colour or a stat line moves thousands. A face whose size changed is real.
`--restore` checks every noise face AND its thumb out of HEAD, so the commit
carries only what someone would see. New (untracked) faces are not touched.
"""
import io
import subprocess
import sys
from collections import defaultdict

from PIL import Image, ImageChops

LEVEL, VISIBLE = 16, 25


def git(*args, binary=False):
    out = subprocess.run(['git', *args], capture_output=True).stdout
    return out if binary else out.decode('utf-8', 'replace')


def classify():
    modified = [line[3:] for line in git('status', '--porcelain', '--', 'public/cards').splitlines()
                if line.startswith(' M') and line.endswith('.png') and '/thumbs/' not in line]
    real, noise = defaultdict(list), []
    for path in modified:
        old = Image.open(io.BytesIO(git('show', f'HEAD:{path}', binary=True))).convert('RGB')
        new = Image.open(path).convert('RGB')
        if old.size != new.size:
            real[path.split('/')[2]].append(path)
            continue
        moved = ImageChops.difference(old, new).convert('L').point(lambda v: 255 if v > LEVEL else 0).histogram()[255]
        (real[path.split('/')[2]].append(path) if moved > VISIBLE else noise.append(path))
    return modified, real, noise


def main():
    modified, real, noise = classify()
    print(f'modified {len(modified)}: real {sum(map(len, real.values()))}, noise {len(noise)}')
    for set_id, paths in sorted(real.items()):
        print(f'  {set_id}: {len(paths)} -> ' + ', '.join(p.split('/')[-1][:-4] for p in sorted(paths)))
    if '--restore' in sys.argv and noise:
        thumbs = [p.replace('public/cards/', 'public/cards/thumbs/')[:-4] + '.webp' for p in noise]
        thumbs = [t for t in thumbs if git('ls-files', t).strip()]
        for batch in (noise, thumbs):
            for i in range(0, len(batch), 100):
                git('checkout', '--', *batch[i:i + 100])
        print(f'restored {len(noise)} noise faces and {len(thumbs)} thumbs from HEAD')


if __name__ == '__main__':
    main()
