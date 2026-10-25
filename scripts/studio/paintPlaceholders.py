# MS-PAINT PLACEHOLDER ART FOR STRATEGY CARDS — a nod to Slay the Spire 2.
#
#   python scripts/studio/paintPlaceholders.py            # every strat without a face or photo
#   python scripts/studio/paintPlaceholders.py --all      # every strat, even the ones with hand-made faces (to a preview folder)
#   python scripts/studio/paintPlaceholders.py denial box_out   # named ids only
#
# ── WHAT THIS IS ────────────────────────────────────────────────────────────
#
# The user (2026-09-06): "Can you generate MS-Paint style illustrations for
# each of the strategy cards as placeholders for now? It's a nod to Slay the
# Spire 2." Slay the Spire 2's beta shipped with deliberately crude MS-Paint
# card art in place of the finished pieces, and it became a signature. These
# are drawn the same way on purpose: aliased lines with a wobble in them,
# flat fills, stick figures, a basketball that is an orange circle with two
# black arcs, and the card's name scrawled in Comic Sans. No anti-aliasing
# anywhere — PIL's plain ImageDraw is exactly the tool.
#
# ── WHERE THE FILES GO, AND WHY A MANIFEST ─────────────────────────────────
#
# The studio composes a face for any strat that lacks a hand-made one in
# public/cards/strats/, and takes its art from card-art/sets/strats/photos/
# {id}.{ext} — so a placeholder dropped there is on the card immediately. But
# the Photo Hunt lists strats WITHOUT a photo, and a placeholder must not hide
# the card from the hunt: _placeholders.json beside the files names every id
# that is only a placeholder, and the hunt keeps asking for the real photo
# until the file is replaced (the manifest entry goes when the id's file is
# not the one this script wrote — checked by the marker chunk in the PNG).
#
# ── THE SCENE LANGUAGE ──────────────────────────────────────────────────────
#
# Every card is one scene: a court (baseline, key, three-point arc, hoop with
# a zigzag net), then figures and props placed by a small vocabulary —
# player(), ball(), arrow(), screen(), dice(), and a few one-off doodles. The
# SCENES table at the bottom maps a strat id to a scene; anything unmapped
# gets a generic "figure with ball" so a brand-new card is never blank.
import json
import math
import os
import random
import sys

from PIL import Image, ImageDraw, ImageFont, PngImagePlugin

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
FACES = os.path.join(ROOT, 'public', 'cards', 'strats')
PHOTOS = os.path.join(ROOT, 'card-art', 'sets', 'strats', 'photos')
PREVIEW = os.path.join(ROOT, 'card-art', 'sets', 'strats', 'placeholder-preview')
MANIFEST = os.path.join(PHOTOS, '_placeholders.json')
MARKER = 'nba-showdown-mspaint-placeholder'

# The strat art window is 773 x 560 on an 825 x 1238 face (object-fit: cover).
W, H = 1160, 840

# MS Paint's default palette, more or less.
BLACK, WHITE = (0, 0, 0), (255, 255, 255)
RED, GREEN, BLUE = (237, 28, 36), (34, 177, 76), (0, 162, 232)
YELLOW, ORANGE, PURPLE = (255, 242, 0), (255, 127, 39), (163, 73, 164)
GREY, BROWN, PINK, TEAL = (127, 127, 127), (185, 122, 87), (255, 174, 201), (0, 128, 128)
SKY, GRASS, HARDWOOD = (200, 230, 255), (181, 230, 29), (239, 213, 160)
NAVY, GOLD = (30, 40, 90), (255, 201, 14)

rng = random.Random()


def font(size, bold=False):
    for name in (('comicbd.ttf' if bold else 'comic.ttf'), 'Inkfree.ttf', 'arial.ttf'):
        try:
            return ImageFont.truetype(os.path.join('C:/Windows/Fonts', name), size)
        except OSError:
            continue
    return ImageFont.load_default()


# ── the wobbly-line toolkit ────────────────────────────────────────────────
def wobble(pts, amt=3):
    return [(x + rng.uniform(-amt, amt), y + rng.uniform(-amt, amt)) for x, y in pts]


def segs(p, q, n=6):
    (x0, y0), (x1, y1) = p, q
    return [(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) for i in range(n + 1)]


def line(d, p, q, fill=BLACK, width=6, amt=3):
    d.line(wobble(segs(p, q), amt), fill=fill, width=width)


def poly(d, pts, fill=None, outline=BLACK, width=6, amt=3):
    pts = wobble(pts, amt)
    if fill is not None:
        d.polygon(pts, fill=fill)
    d.line(pts + [pts[0]], fill=outline, width=width)


def circle(d, c, r, fill=None, outline=BLACK, width=6, amt=2):
    pts = [(c[0] + r * math.cos(t), c[1] + r * math.sin(t)) for t in [i * math.pi / 14 for i in range(28)]]
    pts = wobble(pts, amt)
    if fill is not None:
        d.polygon(pts, fill=fill)
    d.line(pts + [pts[0]], fill=outline, width=width)


def arc(d, c, r, a0, a1, fill=BLACK, width=6, amt=2, n=18):
    pts = [(c[0] + r * math.cos(math.radians(a0 + (a1 - a0) * i / n)), c[1] + r * math.sin(math.radians(a0 + (a1 - a0) * i / n))) for i in range(n + 1)]
    d.line(wobble(pts, amt), fill=fill, width=width)


def arrow(d, p, q, fill=RED, width=8):
    line(d, p, q, fill=fill, width=width)
    ang = math.atan2(q[1] - p[1], q[0] - p[0])
    for s in (1, -1):
        e = (q[0] - 34 * math.cos(ang + s * 0.5), q[1] - 34 * math.sin(ang + s * 0.5))
        line(d, q, e, fill=fill, width=width)


def spray(d, c, r, fill, n=80):
    for _ in range(n):
        t = rng.uniform(0, 2 * math.pi)
        k = rng.uniform(0, r)
        x, y = c[0] + k * math.cos(t), c[1] + k * math.sin(t)
        d.rectangle([x, y, x + 3, y + 3], fill=fill)


def text(d, xy, s, size=64, fill=BLACK, bold=True, shadow=WHITE, anchor='la'):
    f = font(size, bold)
    if shadow is not None:
        for dx, dy in ((-4, -4), (4, -4), (-4, 4), (4, 4), (0, 5), (5, 0), (-5, 0), (0, -5)):
            d.text((xy[0] + dx, xy[1] + dy), s, font=f, fill=shadow, anchor=anchor)
    d.text(xy, s, font=f, fill=fill, anchor=anchor)


# ── props ──────────────────────────────────────────────────────────────────
def ball(d, c, r=30):
    circle(d, c, r, fill=ORANGE, width=5)
    arc(d, c, r, 200, 340, width=4)
    arc(d, c, r, 20, 160, width=4)
    line(d, (c[0], c[1] - r), (c[0], c[1] + r), width=4, amt=2)


def hoop(d, x, y, scale=1.0):
    # backboard, rim, net
    bw, bh = 180 * scale, 120 * scale
    poly(d, [(x - bw / 2, y - bh), (x + bw / 2, y - bh), (x + bw / 2, y), (x - bw / 2, y)], fill=WHITE, width=6)
    poly(d, [(x - 40 * scale, y - 70 * scale), (x + 40 * scale, y - 70 * scale), (x + 40 * scale, y - 20 * scale), (x - 40 * scale, y - 20 * scale)], width=4)
    rim_w = 90 * scale
    d.ellipse([x - rim_w / 2, y - 12, x + rim_w / 2, y + 12], outline=RED, width=7)
    for i in range(5):
        xx = x - rim_w / 2 + rim_w * i / 4
        zig = [(xx, y + 10), (xx + 12 * scale, y + 40 * scale), (xx - 8 * scale, y + 70 * scale), (xx + 10 * scale, y + 100 * scale)]
        d.line(wobble(zig, 2), fill=WHITE, width=4)


def court(d, floor=HARDWOOD, sky=SKY):
    d.rectangle([0, 0, W, H], fill=sky)
    d.rectangle([0, H * 0.42, W, H], fill=floor)
    # three-point arc and key, seen from behind the baseline
    arc(d, (W / 2, H * 0.46), 520, 195, 345, width=7, amt=3, n=30)
    poly(d, [(W / 2 - 150, H * 0.46), (W / 2 + 150, H * 0.46), (W / 2 + 190, H * 0.86), (W / 2 - 190, H * 0.86)], width=6)
    hoop(d, W / 2, H * 0.40)
    # the sun, because it is MS Paint
    circle(d, (W - 110, 95), 55, fill=YELLOW, width=5)
    for i in range(8):
        a = i * math.pi / 4
        line(d, (W - 110 + 70 * math.cos(a), 95 + 70 * math.sin(a)), (W - 110 + 100 * math.cos(a), 95 + 100 * math.sin(a)), width=5)


def player(d, x, y, color=BLUE, h=220, pose='stand', face=True, number=None, wide=False):
    """A stick figure standing on (x, y). Poses: stand, shoot, arms_up, run, dive, flex, sit, back, box, wave, hug."""
    head = 34
    hy = y - h
    torso_top = hy + head * 2
    torso_bot = y - h * 0.42
    circle(d, (x, hy + head), head, fill=PINK if face else color, width=5)
    if face:
        d.ellipse([x - 12, hy + head - 8, x - 6, hy + head - 2], fill=BLACK)
        d.ellipse([x + 6, hy + head - 8, x + 12, hy + head - 2], fill=BLACK)
        arc(d, (x, hy + head + 4), 14, 20, 160, width=3)
    # jersey
    poly(d, [(x - 34, torso_top), (x + 34, torso_top), (x + 40, torso_bot), (x - 40, torso_bot)], fill=color, width=5)
    if number is not None:
        text(d, (x, (torso_top + torso_bot) / 2), str(number), size=40, fill=WHITE, shadow=None, anchor='mm')
    # legs
    if pose == 'sit':
        line(d, (x - 20, torso_bot), (x - 70, torso_bot + 10), color=BLACK) if False else line(d, (x - 20, torso_bot), (x - 70, torso_bot + 10), width=7)
        line(d, (x + 20, torso_bot), (x + 70, torso_bot + 10), width=7)
        line(d, (x - 70, torso_bot + 10), (x - 70, y), width=7)
        line(d, (x + 70, torso_bot + 10), (x + 70, y), width=7)
    elif pose == 'run':
        line(d, (x - 20, torso_bot), (x - 80, y - 40), width=7)
        line(d, (x - 80, y - 40), (x - 60, y), width=7)
        line(d, (x + 20, torso_bot), (x + 60, y - 30), width=7)
        line(d, (x + 60, y - 30), (x + 95, y), width=7)
    elif pose == 'dive':
        line(d, (x - 20, torso_bot), (x - 90, y - 20), width=7)
        line(d, (x + 20, torso_bot), (x - 60, y), width=7)
    elif pose == 'box':
        line(d, (x - 20, torso_bot), (x - 70, y), width=7)
        line(d, (x + 20, torso_bot), (x + 70, y), width=7)
    else:
        line(d, (x - 20, torso_bot), (x - 40, y), width=7)
        line(d, (x + 20, torso_bot), (x + 40, y), width=7)
    # arms
    sh = torso_top + 12
    if pose in ('shoot',):
        line(d, (x + 30, sh), (x + 70, sh - 60), width=7)
        line(d, (x + 70, sh - 60), (x + 60, sh - 120), width=7)
        line(d, (x - 30, sh), (x - 60, sh - 50), width=7)
    elif pose in ('arms_up', 'wave', 'flex'):
        for s in (1, -1):
            line(d, (x + 30 * s, sh), (x + 80 * s, sh - 50), width=7)
            line(d, (x + 80 * s, sh - 50), (x + 60 * s, sh - 120), width=7)
        if pose == 'flex':
            for s in (1, -1):
                circle(d, (x + 72 * s, sh - 60), 22, fill=PINK, width=4)
    elif pose == 'box':
        line(d, (x + 30, sh), (x + 90, sh + 40), width=7)
        line(d, (x - 30, sh), (x - 90, sh + 40), width=7)
    elif pose == 'dive':
        line(d, (x + 30, sh), (x + 110, sh - 30), width=7)
        line(d, (x - 30, sh), (x + 60, sh - 60), width=7)
    elif pose == 'hug':
        line(d, (x + 30, sh), (x + 110, sh + 30), width=7)
        line(d, (x + 110, sh + 30), (x + 130, sh - 10), width=7)
        line(d, (x - 30, sh), (x + 90, sh + 70), width=7)
    elif pose == 'wide' or wide:
        line(d, (x + 30, sh), (x + 130, sh + 10), width=7)
        line(d, (x - 30, sh), (x - 130, sh + 10), width=7)
    elif pose == 'back':
        line(d, (x + 30, sh), (x + 60, sh + 80), width=7)
        line(d, (x - 30, sh), (x - 60, sh + 80), width=7)
    else:
        line(d, (x + 30, sh), (x + 60, sh + 70), width=7)
        line(d, (x - 30, sh), (x - 60, sh + 70), width=7)
    return (x, hy + head)


def whistle(d, x, y):
    """A ref's whistle, mid-tweet."""
    circle(d, (x, y), 34, fill=GREY, width=5)
    poly(d, [(x + 20, y - 24), (x + 90, y - 34), (x + 90, y - 4), (x + 20, y + 16)], fill=GREY, width=5)
    circle(d, (x - 6, y - 4), 9, fill=BLACK, width=3)
    for i, r in enumerate((46, 66, 86)):
        arc(d, (x + 90, y - 18), r, -55, 55, width=4 + i % 2)


def bench(d, x, y, w=300):
    """A wooden bench, seen side on."""
    poly(d, [(x - w / 2, y - 40), (x + w / 2, y - 40), (x + w / 2, y - 10), (x - w / 2, y - 10)], fill=BROWN, width=6)
    for s2 in (-1, 1):
        line(d, (x + s2 * (w / 2 - 30), y - 10), (x + s2 * (w / 2 - 30), y + 60), width=8)


def screen_wall(d, x, y):
    poly(d, [(x - 60, y - 200), (x + 60, y - 200), (x + 60, y), (x - 60, y)], fill=BROWN, width=6)
    for row in range(5):
        yy = y - 200 + row * 40
        line(d, (x - 60, yy), (x + 60, yy), width=3, amt=1)
        line(d, (x - 60 + (30 if row % 2 else 0), yy), (x - 60 + (30 if row % 2 else 0), yy + 40), width=3, amt=1)


def d20(d, c, r, label='20'):
    pts = [(c[0] + r * math.cos(math.radians(90 + 60 * i)), c[1] + r * math.sin(math.radians(90 + 60 * i))) for i in range(6)]
    poly(d, pts, fill=WHITE, width=6)
    tri = [(c[0] + r * 0.62 * math.cos(math.radians(90 + 120 * i)), c[1] + r * 0.62 * math.sin(math.radians(90 + 120 * i))) for i in range(3)]
    poly(d, tri, width=5)
    for i in range(3):
        line(d, tri[i], pts[(2 * i + 1) % 6], width=4)
    text(d, (c[0], c[1] + 4), label, size=int(r * 0.55), shadow=None, anchor='mm')


def star(d, c, r, fill=YELLOW):
    pts = []
    for i in range(10):
        rr = r if i % 2 == 0 else r * 0.45
        a = math.radians(-90 + 36 * i)
        pts.append((c[0] + rr * math.cos(a), c[1] + rr * math.sin(a)))
    poly(d, pts, fill=fill, width=5)


def burst(d, c, r=60, fill=YELLOW):
    pts = []
    for i in range(16):
        rr = r if i % 2 == 0 else r * 0.55
        a = math.radians(360 * i / 16)
        pts.append((c[0] + rr * math.cos(a), c[1] + rr * math.sin(a)))
    poly(d, pts, fill=fill, width=5)


def snowflake(d, c, r):
    for i in range(6):
        a = math.radians(30 + 60 * i)
        e = (c[0] + r * math.cos(a), c[1] + r * math.sin(a))
        line(d, c, e, fill=BLUE, width=6)
        for s in (1, -1):
            m = (c[0] + 0.6 * r * math.cos(a), c[1] + 0.6 * r * math.sin(a))
            line(d, m, (m[0] + 0.3 * r * math.cos(a + s * 0.8), m[1] + 0.3 * r * math.sin(a + s * 0.8)), fill=BLUE, width=5)


def clipboard(d, x, y):
    poly(d, [(x - 90, y - 130), (x + 90, y - 130), (x + 90, y + 130), (x - 90, y + 130)], fill=BROWN, width=6)
    poly(d, [(x - 75, y - 105), (x + 75, y - 105), (x + 75, y + 115), (x - 75, y + 115)], fill=WHITE, width=4)
    poly(d, [(x - 35, y - 150), (x + 35, y - 150), (x + 35, y - 115), (x - 35, y - 115)], fill=GREY, width=4)
    for i, (sx, sy) in enumerate([(-40, -60), (20, -30), (-20, 20), (40, 60)]):
        if i % 2:
            circle(d, (x + sx, y + sy), 16, width=4)
        else:
            line(d, (x + sx - 14, y + sy - 14), (x + sx + 14, y + sy + 14), width=4)
            line(d, (x + sx - 14, y + sy + 14), (x + sx + 14, y + sy - 14), width=4)
    arrow(d, (x - 40, y - 45), (x + 20, y - 38), fill=RED, width=4)


def battery(d, x, y):
    poly(d, [(x - 120, y - 60), (x + 120, y - 60), (x + 120, y + 60), (x - 120, y + 60)], fill=WHITE, width=6)
    poly(d, [(x + 120, y - 25), (x + 145, y - 25), (x + 145, y + 25), (x + 120, y + 25)], fill=GREY, width=5)
    for i in range(3):
        poly(d, [(x - 105 + i * 75, y - 45), (x - 45 + i * 75, y - 45), (x - 45 + i * 75, y + 45), (x - 105 + i * 75, y + 45)], fill=GREEN, width=3)


def anchor_doodle(d, x, y):
    circle(d, (x, y - 110), 22, width=6)
    line(d, (x, y - 88), (x, y + 60), width=8)
    line(d, (x - 70, y - 40), (x + 70, y - 40), width=7)
    arc(d, (x, y - 20), 90, 20, 160, width=8)
    for s in (1, -1):
        line(d, (x + 90 * s, y + 10), (x + 70 * s, y + 40), width=7)


def bee(d, x, y):
    d.ellipse([x - 24, y - 14, x + 24, y + 14], fill=YELLOW, outline=BLACK, width=3)
    for i in range(3):
        d.line([(x - 14 + i * 12, y - 14), (x - 14 + i * 12, y + 14)], fill=BLACK, width=4)
    d.ellipse([x - 16, y - 34, x + 2, y - 12], fill=WHITE, outline=BLACK, width=2)
    d.ellipse([x + 2, y - 34, x + 20, y - 12], fill=WHITE, outline=BLACK, width=2)
    d.line([(x + 24, y), (x + 38, y - 4)], fill=BLACK, width=3)


def hammer(d, x, y):
    poly(d, [(x - 12, y - 20), (x + 12, y - 20), (x + 12, y + 130), (x - 12, y + 130)], fill=BROWN, width=5)
    poly(d, [(x - 70, y - 80), (x + 70, y - 80), (x + 70, y - 10), (x - 70, y - 10)], fill=GREY, width=6)


def broom(d, x, y):
    line(d, (x, y - 200), (x + 30, y), fill=BROWN, width=9)
    poly(d, [(x - 10, y), (x + 70, y), (x + 100, y + 90), (x - 50, y + 90)], fill=GOLD, width=5)
    for i in range(6):
        line(d, (x - 40 + i * 24, y + 20), (x - 46 + i * 24, y + 90), width=3, amt=1)


def cape(d, x, y, h=220, color=RED):
    top = y - h + 70
    poly(d, [(x - 34, top), (x + 34, top), (x + 110, y - 60), (x - 40, y - 40)], fill=color, width=5)


def mask_no(d, c, r=90):
    circle(d, c, r, outline=RED, width=14, amt=1)
    line(d, (c[0] - r * 0.7, c[1] - r * 0.7), (c[0] + r * 0.7, c[1] + r * 0.7), fill=RED, width=14, amt=1)


def caption(d, s):
    # Sits clear of the bottom-right corner: the strat face lays a white
    # diagonal wedge and chevron dot-work over that corner of the art window.
    text(d, (W * 0.42, H - 120), s, size=72, fill=BLACK, shadow=WHITE, anchor='mm')


# ── scenes ─────────────────────────────────────────────────────────────────
def s_hack_a(d, s):
    # HACK-A-____: the foul comes before the play does. The shooter is wrapped
    # up before they can go to work, the whistle goes, and all that is left is
    # two trips to the line, each one harder (two free throws at -3).
    court(d)
    player(d, W / 2 + 40, H * 0.94, BLUE, h=320, pose='stand', number=34)
    player(d, W / 2 - 150, H * 0.94, RED, h=250, pose='hug', number=5)
    ball(d, (W / 2 + 150, H * 0.62))
    whistle(d, 120, 150)
    text(d, (250, 96), 'TWEET!', size=58, fill=RED, anchor='la')
    # the only offence left: two trips up at the rim, and neither one easy
    for c in ((900, 505), (790, 420)):
        ball(d, c, r=24)
    text(d, (960, 470), 'x2', size=64, fill=BLACK, anchor='lm')
    text(d, (960, 560), '-3', size=64, fill=RED, anchor='lm')


def s_foul_trouble(d, s):
    # FOUL TROUBLE: beaten one time too many, so the coach sits him. The tally
    # is the reason; the arrow is the walk to the bench.
    court(d)
    player(d, W / 2 - 330, H * 0.95, BLUE, h=250, pose='run', number=7)
    ball(d, (W / 2 - 210, H * 0.70))
    # the seat under him: the sit pose puts his thighs at h * 0.42 off the floor
    bench(d, W - 230, H * 0.95 - 210 * 0.42 + 40)
    player(d, W - 230, H * 0.95, RED, h=210, pose='sit', number=21)
    whistle(d, 120, 150)
    for i in range(4):
        line(d, (600 + i * 30, 118), (592 + i * 30, 190), width=7)
    line(d, (592, 190), (712, 112), fill=RED, width=7)
    text(d, (760, 152), 'PF 5', size=58, fill=RED, anchor='lm')
    arrow(d, (W / 2 + 90, H * 0.58), (W - 400, H * 0.72))


def s_generic(d, s):
    court(d)
    player(d, W / 2 - 140, H * 0.9, BLUE, pose='shoot', number=1)
    ball(d, (W / 2 - 60, H * 0.9 - 340))
    player(d, W / 2 + 120, H * 0.9, RED, pose='arms_up', number=2)


def s_double_team(d, s):
    court(d)
    player(d, W / 2, H * 0.92, BLUE, pose='stand', number=1)
    ball(d, (W / 2 - 70, H * 0.92 - 160))
    player(d, W / 2 - 190, H * 0.9, RED, pose='wide')
    player(d, W / 2 + 190, H * 0.9, RED, pose='wide')
    burst(d, (W / 2, H * 0.92 - 300), 50, fill=YELLOW)
    text(d, (W / 2, H * 0.92 - 300), '!!', size=54, shadow=None, anchor='mm')


def s_pick_up_full_court(d, s):
    court(d)
    line(d, (0, H * 0.62), (W, H * 0.62), width=6)
    circle(d, (W / 2, H * 0.62), 120, width=6)
    player(d, W / 2 - 60, H * 0.95, BLUE, pose='run', number=1)
    ball(d, (W / 2 - 130, H * 0.95 - 120))
    player(d, W / 2 + 90, H * 0.95, RED, pose='wide')
    for i in range(3):
        arc(d, (W / 2 + 200 + i * 40, H * 0.95 - 160), 30, -60, 60, width=4)


def s_cross_court_dime(d, s):
    court(d)
    player(d, 170, H * 0.9, BLUE, pose='shoot', number=7)
    player(d, W - 170, H * 0.9, BLUE, pose='arms_up', number=3)
    ball(d, (W / 2, 200))
    arc(d, (W / 2, 1000), 860, 235, 305, fill=RED, width=8, n=40)
    arrow(d, (W - 260, 250), (W - 200, 400), fill=RED)


def s_desperation_press(d, s):
    court(d, sky=(255, 220, 200))
    player(d, W / 2 - 60, H * 0.95, BLUE, pose='stand', number=1)
    ball(d, (W / 2 - 130, H * 0.95 - 160))
    for x in (W / 2 - 260, W / 2 + 120, W / 2 + 280):
        player(d, x, H * 0.92, RED, pose='wide')
    for i in range(3):
        text(d, (200 + i * 60, 160 + i * 40), '!', size=90, fill=RED, shadow=WHITE, anchor='mm')
    burst(d, (W - 320, 200), 70, fill=RED)
    text(d, (W - 320, 200), '0:12', size=40, fill=WHITE, shadow=None, anchor='mm')


def s_second_closer(d, s):
    court(d)
    player(d, W / 2 - 200, H * 0.92, BLUE, pose='shoot', number=1)
    player(d, W / 2 + 160, H * 0.92, BLUE, pose='shoot', number=2)
    star(d, (W / 2 - 200, H * 0.92 - 300), 50)
    star(d, (W / 2 + 160, H * 0.92 - 300), 50)
    ball(d, (W / 2 + 60, 260))
    text(d, (W / 2, 120), 'x2', size=110, fill=RED, shadow=WHITE, anchor='mm')


def s_ato_masterpiece(d, s):
    d.rectangle([0, 0, W, H], fill=(230, 230, 230))
    clipboard(d, W / 2 - 250, H / 2 - 40)
    player(d, W / 2 + 120, H * 0.9, GREY, pose='arms_up', face=True)
    text(d, (W / 2 + 120, 120), 'COACH', size=60, shadow=WHITE, anchor='mm')
    for i in range(4):
        star(d, (W / 2 + 250 + i * 70, 300 + (i % 2) * 40), 26)


def s_fresh_legs(d, s):
    court(d)
    poly(d, [(80, H * 0.7), (520, H * 0.7), (520, H * 0.78), (80, H * 0.78)], fill=BROWN, width=5)
    player(d, 200, H * 0.7, GREY, pose='sit')
    player(d, 400, H * 0.7, GREY, pose='sit')
    player(d, W - 260, H * 0.94, BLUE, pose='run', number=9)
    for i in range(3):
        poly(d, [(W - 400 - i * 30, 260 + i * 30), (W - 370 - i * 30, 290 + i * 30), (W - 385 - i * 30, 290 + i * 30), (W - 355 - i * 30, 330 + i * 30), (W - 395 - i * 30, 300 + i * 30), (W - 380 - i * 30, 300 + i * 30)], fill=YELLOW, width=3)


def s_ice_the_hot_hand(d, s):
    court(d, sky=(210, 235, 255))
    player(d, W / 2 - 120, H * 0.92, RED, pose='shoot', number=23)
    for i in range(3):
        snowflake(d, (W / 2 - 220 + i * 110, 200 + (i % 2) * 60), 45)
    ball(d, (W / 2 - 40, H * 0.92 - 340))
    spray(d, (W / 2 - 40, H * 0.92 - 340), 90, BLUE, 120)
    player(d, W / 2 + 160, H * 0.92, BLUE, pose='wide')


def s_reset(d, s):
    court(d)
    player(d, W / 2, H * 0.92, BLUE, pose='arms_up', number=1)
    arc(d, (W / 2, 280), 130, 300, 600, fill=GREEN, width=10, n=30)
    arrow(d, (W / 2 - 90, 380), (W / 2 - 130, 330), fill=GREEN, width=10)
    snowflake(d, (200, 200), 40)
    line(d, (150, 250), (250, 150), fill=RED, width=12)


def s_spain(d, s):
    court(d)
    screen_wall(d, W / 2 - 40, H * 0.86)
    player(d, W / 2 - 250, H * 0.92, BLUE, pose='run', number=1)
    player(d, W / 2 + 180, H * 0.9, BLUE, pose='arms_up', number=5)
    ball(d, (W / 2 - 320, H * 0.92 - 170))
    arrow(d, (W / 2 - 200, H * 0.55), (W / 2 + 60, H * 0.5), fill=RED)
    arrow(d, (W / 2 + 180, H * 0.6), (W / 2 + 40, H * 0.72), fill=GREEN)
    text(d, (W / 2, 120), 'OLE!', size=90, fill=RED, shadow=YELLOW, anchor='mm')


def s_mismatch(d, s):
    court(d)
    player(d, W / 2 - 120, H * 0.95, BLUE, h=300, pose='stand', number=34)
    player(d, W / 2 + 120, H * 0.95, RED, h=150, pose='arms_up')
    ball(d, (W / 2 - 200, H * 0.95 - 200))
    text(d, (W / 2, 120), '+4', size=120, fill=GREEN, shadow=WHITE, anchor='mm')


def s_strength(d, s):
    court(d)
    for i, x in enumerate(range(150, W - 100, 215)):
        player(d, x, H * 0.92, BLUE, pose='flex', number=i + 1)
    text(d, (W / 2, 120), '5 x  +1', size=100, fill=RED, shadow=WHITE, anchor='mm')


def s_energizer(d, s):
    court(d)
    player(d, W / 2 - 200, H * 0.92, BLUE, pose='wide', number=45)
    battery(d, W / 2 + 200, 220)
    for i in range(3):
        poly(d, [(W / 2 - 240 - i * 40, 220), (W / 2 - 210 - i * 40, 260), (W / 2 - 225 - i * 40, 260), (W / 2 - 200 - i * 40, 310), (W / 2 - 235 - i * 40, 270), (W / 2 - 220 - i * 40, 270)], fill=YELLOW, width=3)
    text(d, (W / 2 - 200, H * 0.92 - 300), '$249', size=50, fill=GREEN, shadow=WHITE, anchor='mm')


def s_identity(d, s):
    court(d)
    for i, x in enumerate(range(150, W - 100, 215)):
        player(d, x, H * 0.92, BLUE, pose='wide', number=i + 1)
    pts = [(W / 2 - 110, 90), (W / 2 + 110, 90), (W / 2 + 110, 220), (W / 2, 300), (W / 2 - 110, 220)]
    poly(d, pts, fill=BLUE, width=7)
    text(d, (W / 2, 190), 'D', size=100, fill=WHITE, shadow=None, anchor='mm')


def s_anchor(d, s):
    court(d)
    player(d, W / 2 + 150, H * 0.92, BLUE, h=280, pose='wide', number=13)
    anchor_doodle(d, W / 2 - 220, 360)
    player(d, W / 2 + 400, H * 0.9, RED, pose='stand', number=0)
    text(d, (W / 2 + 400, H * 0.9 - 300), '+0', size=70, fill=RED, shadow=WHITE, anchor='mm')


def s_swarm(d, s):
    court(d)
    player(d, W / 2, H * 0.92, RED, pose='arms_up', number=30)
    text(d, (W / 2, H * 0.92 - 330), '$$$', size=60, fill=GREEN, shadow=WHITE, anchor='mm')
    for i in range(9):
        a = i * 2 * math.pi / 9
        bee(d, W / 2 + 200 * math.cos(a), H * 0.55 + 140 * math.sin(a))
    d20(d, (200, 220), 90, '11+')


def s_five_out(d, s):
    court(d)
    for i in range(5):
        a = math.radians(205 + 32.5 * i)
        x, y = W / 2 + 470 * math.cos(a), H * 0.46 + 470 * math.sin(a) + 100
        player(d, x, y + 160, BLUE, h=160, pose='shoot', number=i + 1)
    ball(d, (W / 2, 140))
    ball(d, (W / 2 - 120, 190))


def s_hammer(d, s):
    court(d)
    player(d, W / 2 - 80, H * 0.94, BLUE, pose='shoot', number=4)
    hammer(d, W / 2 + 180, 220)
    ball(d, (W / 2 + 10, H * 0.94 - 340))
    text(d, (W / 2 - 80, H * 0.94 - 330), 'no 3PT?', size=44, fill=RED, shadow=WHITE, anchor='mm')


def s_iso(d, s):
    court(d, sky=(60, 60, 80), floor=(90, 80, 60))
    poly(d, [(W / 2 - 60, 0), (W / 2 + 60, 0), (W / 2 + 260, H), (W / 2 - 260, H)], fill=(255, 250, 200), outline=(255, 250, 200), width=1, amt=0)
    player(d, W / 2, H * 0.94, BLUE, pose='stand', number=1)
    ball(d, (W / 2 - 80, H * 0.94 - 150))
    for x in (120, 300, W - 300, W - 120):
        player(d, x, H * 0.9, (70, 70, 90), pose='stand', face=False)


def s_barrage(d, s):
    court(d)
    for i, x in enumerate((W / 2 - 330, W / 2 - 60, W / 2 + 220)):
        player(d, x, H * 0.94, BLUE, pose='shoot', number=i + 1)
    for i, x in enumerate((W / 2 - 260, W / 2 + 10, W / 2 + 290)):
        ball(d, (x, 210 + (i % 2) * 60))
        arc(d, (x - 40, 400), 200, 240, 330, fill=RED, width=5)


def s_crash_kick(d, s):
    court(d)
    player(d, W / 2 - 40, H * 0.9, BLUE, pose='arms_up', number=21)
    ball(d, (W / 2 - 40, H * 0.9 - 380))
    player(d, W - 220, H * 0.94, BLUE, pose='shoot', number=3)
    arrow(d, (W / 2 + 40, H * 0.9 - 340), (W - 300, H * 0.94 - 260), fill=RED)
    text(d, (180, 160), '-3 REB', size=50, fill=RED, shadow=WHITE, anchor='mm')
    text(d, (180, 230), '-1 AST', size=50, fill=RED, shadow=WHITE, anchor='mm')


def s_pick_pop(d, s):
    court(d)
    screen_wall(d, W / 2 - 60, H * 0.86)
    player(d, W / 2 - 300, H * 0.94, BLUE, pose='stand', number=1)
    ball(d, (W / 2 - 360, H * 0.94 - 160))
    player(d, W / 2 + 260, H * 0.9, BLUE, pose='shoot', number=5)
    arrow(d, (W / 2 - 20, H * 0.62), (W / 2 + 200, H * 0.55), fill=GREEN)
    burst(d, (W / 2 + 260, 200), 60, fill=YELLOW)
    text(d, (W / 2 + 260, 200), 'POP', size=40, shadow=None, anchor='mm')


def s_extra_pass(d, s):
    court(d)
    xs = (170, 450, 730, W - 170)
    for i, x in enumerate(xs):
        player(d, x, H * 0.93, BLUE, pose='arms_up' if i == 3 else 'stand', number=i + 1)
    for i in range(3):
        arrow(d, (xs[i] + 60, H * 0.62), (xs[i + 1] - 60, H * 0.62), fill=RED)
    ball(d, (xs[3], H * 0.93 - 380))


def s_lob_city(d, s):
    court(d, sky=(255, 235, 200))
    player(d, W / 2 - 350, H * 0.94, BLUE, pose='shoot', number=3)
    player(d, W / 2 + 40, H * 0.55, BLUE, h=260, pose='arms_up', number=6)
    arc(d, (W / 2 - 150, 700), 560, 215, 290, fill=RED, width=8, n=30)
    ball(d, (W / 2 + 40, 150))
    for i in range(6):
        star(d, (120 + i * 190, 120 + (i % 2) * 50), 28)


def s_stretch_five(d, s):
    court(d)
    player(d, W / 2 - 280, H * 0.96, BLUE, h=330, pose='shoot', number=5)
    ball(d, (W / 2 - 180, 200))
    player(d, W / 2 + 120, H * 0.9, BLUE, pose='arms_up', number=4)
    player(d, W / 2 + 330, H * 0.92, RED, pose='stand')
    text(d, (W / 2 - 280, 120), 'C', size=110, fill=RED, shadow=WHITE, anchor='mm')


def s_post_domination(d, s):
    court(d)
    player(d, W / 2 - 100, H * 0.95, BLUE, h=300, pose='back', number=50)
    player(d, W / 2 + 180, H * 0.95, BLUE, h=290, pose='arms_up', number=15)
    ball(d, (W / 2 + 180, H * 0.95 - 420))
    text(d, (W / 2, 120), 'x2 REB', size=90, fill=RED, shadow=WHITE, anchor='mm')


def s_unsung_hero(d, s):
    court(d)
    cape(d, W / 2, H * 0.94)
    player(d, W / 2, H * 0.94, BLUE, pose='flex', number=99)
    d20(d, (220, 240), 80, '20')
    d20(d, (W - 220, 240), 80, '7')
    text(d, (W / 2, 120), '$400', size=70, fill=GREEN, shadow=WHITE, anchor='mm')


def s_transition_outlet(d, s):
    court(d)
    player(d, 200, H * 0.92, BLUE, pose='arms_up', number=1)
    ball(d, (200, H * 0.92 - 380))
    arrow(d, (280, H * 0.5), (W - 320, H * 0.5), fill=RED)
    player(d, W - 200, H * 0.96, BLUE, pose='run', number=8)
    for i in range(3):
        line(d, (W - 320 - i * 30, H * 0.8 + i * 20), (W - 260 - i * 30, H * 0.8 + i * 20), width=5)


def s_open_man(d, s):
    court(d)
    player(d, W / 2 + 280, H * 0.92, BLUE, pose='wave', number=11)
    burst(d, (W / 2 + 280, 200), 70, fill=YELLOW)
    text(d, (W / 2 + 280, 200), 'HEY!', size=44, shadow=None, anchor='mm')
    player(d, W / 2 - 260, H * 0.94, BLUE, pose='stand', number=1)
    player(d, W / 2 - 420, H * 0.9, RED, pose='wide')
    player(d, W / 2 - 100, H * 0.9, RED, pose='wide')
    ball(d, (W / 2 - 330, H * 0.94 - 160))


def s_putback_specialist(d, s):
    court(d)
    player(d, W / 2 + 40, H * 0.95, BLUE, h=270, pose='arms_up', number=42)
    ball(d, (W / 2 + 40, H * 0.4 - 90))
    arc(d, (W / 2 + 40, H * 0.4 - 40), 60, 200, 340, fill=RED, width=6)
    text(d, (W / 2 - 300, 220), 'CLANK', size=70, fill=RED, shadow=WHITE, anchor='mm')
    text(d, (W / 2 - 300, 300), '-2 REB', size=50, fill=GREEN, shadow=WHITE, anchor='mm')


def s_rim_protector(d, s):
    court(d)
    player(d, W / 2 + 60, H * 0.96, BLUE, h=330, pose='arms_up', number=33)
    player(d, W / 2 - 260, H * 0.94, RED, pose='shoot', number=1)
    ball(d, (W / 2 - 150, 330))
    text(d, (W / 2 - 150, 220), 'NO!', size=90, fill=RED, shadow=WHITE, anchor='mm')
    mask_no(d, (W / 2 - 150, 330), 70)


def s_drop_coverage(d, s):
    court(d)
    player(d, W / 2 + 40, H * 0.9, BLUE, pose='wide', number=22)
    player(d, W / 2 - 320, H * 0.95, RED, pose='run', number=1)
    ball(d, (W / 2 - 400, H * 0.95 - 170))
    arrow(d, (W / 2 + 40, H * 0.52), (W / 2 + 40, H * 0.68), fill=GREEN)
    text(d, (W / 2 + 40, 180), 'DROP', size=70, fill=GREEN, shadow=WHITE, anchor='mm')


def s_smothering(d, s):
    court(d)
    player(d, W / 2 - 40, H * 0.94, RED, pose='stand', number=1)
    player(d, W / 2 - 160, H * 0.94, BLUE, pose='hug', number=2)
    ball(d, (W / 2 + 40, H * 0.94 - 160))
    for i in range(3):
        text(d, (W / 2 + 200 + i * 40, 200 + i * 60), 'z', size=50, fill=GREY, shadow=WHITE, anchor='mm')
    text(d, (W / 2, 120), 'SMOTHER', size=80, fill=BLUE, shadow=WHITE, anchor='mm')


def s_denial(d, s):
    court(d)
    player(d, W / 2 + 120, H * 0.94, BLUE, pose='arms_up', number=8)
    player(d, W / 2 - 250, H * 0.94, RED, pose='shoot', number=1)
    circle(d, (W / 2 + 120, 240), 70, fill=PINK, width=5)
    for i in range(4):
        line(d, (W / 2 + 80 + i * 26, 190), (W / 2 + 80 + i * 26, 240), width=5)
    mask_no(d, (W / 2 + 120, 240), 100)
    text(d, (W / 2 - 250, 140), '-2 AST', size=60, fill=RED, shadow=WHITE, anchor='mm')


def s_hustle(d, s):
    court(d)
    player(d, W / 2 - 60, H * 0.9, BLUE, pose='dive', number=0)
    player(d, W / 2 + 250, H * 0.95, RED, h=280, pose='shoot', number=30)
    ball(d, (W / 2 + 300, 260))
    text(d, (W / 2 + 250, 140), '$800+', size=60, fill=GREEN, shadow=WHITE, anchor='mm')
    text(d, (W / 2 - 200, 200), '$399', size=60, fill=BLUE, shadow=WHITE, anchor='mm')
    spray(d, (W / 2 - 100, H * 0.88), 80, HARDWOOD, 60)


def s_glass_cleaner(d, s):
    court(d)
    player(d, W / 2 + 100, H * 0.96, BLUE, h=300, pose='arms_up', number=24)
    broom(d, W / 2 - 220, H * 0.5)
    ball(d, (W / 2 + 100, 150))
    spray(d, (W / 2 + 60, H * 0.35), 120, BLUE, 100)
    text(d, (W / 2, 90), '+2 REB', size=70, fill=GREEN, shadow=WHITE, anchor='mm')


def s_box_out(d, s):
    court(d)
    player(d, W / 2 + 60, H * 0.95, BLUE, h=250, pose='box', number=44)
    player(d, W / 2 + 260, H * 0.93, RED, pose='arms_up', number=1)
    ball(d, (W / 2 + 60, 120))
    poly(d, [(W / 2 - 350, H * 0.6), (W / 2 - 150, H * 0.6), (W / 2 - 150, H * 0.8), (W / 2 - 350, H * 0.8)], fill=BROWN, width=6)
    text(d, (W / 2 - 250, H * 0.7), 'BOX', size=50, fill=WHITE, shadow=None, anchor='mm')
    arrow(d, (W / 2 + 130, H * 0.62), (W / 2 + 230, H * 0.62), fill=RED)


# ── THE GLASS (2026-09-23) ──────────────────────────────────────────────────
def s_kick_out_three(d, s):
    court(d)
    player(d, W / 2 - 60, H * 0.95, BLUE, h=280, pose='arms_up', number=34)
    player(d, W - 170, H * 0.95, BLUE, pose='shoot', number=3)
    ball(d, (W - 230, H * 0.42))
    arrow(d, (W / 2 - 20, H * 0.45), (W - 280, H * 0.45), fill=RED)
    text(d, (W / 2 - 160, 150), 'CLANK', size=60, fill=RED, shadow=WHITE, anchor='mm')
    text(d, (W - 230, 150), '3!', size=90, fill=GREEN, shadow=WHITE, anchor='mm')


def s_grab_and_go(d, s):
    court(d)
    player(d, W / 2 - 200, H * 0.95, BLUE, h=280, pose='arms_up', number=13)
    ball(d, (W / 2 - 200, H * 0.95 - 400))
    arrow(d, (W / 2 - 60, H * 0.55), (W / 2 + 220, H * 0.55), fill=GREEN)
    text(d, (W / 2 - 200, 130), '-3 REB', size=60, fill=RED, shadow=WHITE, anchor='mm')
    text(d, (W / 2 + 230, 130), '+2 AST', size=60, fill=GREEN, shadow=WHITE, anchor='mm')


def s_rebound_and_push(d, s):
    court(d)
    player(d, 200, H * 0.95, BLUE, h=290, pose='arms_up', number=21)
    ball(d, (200, H * 0.95 - 410))
    arrow(d, (300, H * 0.6), (W - 300, H * 0.6), fill=GREEN)
    player(d, W - 200, H * 0.95, BLUE, pose='run', number=21)
    for i in range(3):
        line(d, (W - 330 - i * 30, H * 0.82 + i * 20), (W - 270 - i * 30, H * 0.82 + i * 20), width=5)
    text(d, (W / 2, 130), 'PUSH IT', size=80, fill=RED, shadow=WHITE, anchor='mm')


def s_own_the_glass(d, s):
    court(d)
    player(d, W / 2 - 150, H * 0.96, BLUE, h=320, pose='arms_up', number=6)
    player(d, W / 2 + 150, H * 0.96, BLUE, h=320, pose='arms_up', number=6)
    ball(d, (W / 2 - 150, H * 0.96 - 440))
    ball(d, (W / 2 + 150, H * 0.96 - 440))
    player(d, W / 2 + 380, H * 0.9, RED, pose='stand', number=1)
    text(d, (W / 2, 120), 'MINE', size=100, fill=GREEN, shadow=WHITE, anchor='mm')


def s_blitz(d, s):
    # Two at the shooter, and the ball has to go somewhere else (2026-09-25).
    court(d)
    player(d, 280, H * 0.93, BLUE, pose='stand', number=30)
    ball(d, (280 - 70, H * 0.93 - 170))
    player(d, 120, H * 0.9, RED, pose='wide')
    player(d, 440, H * 0.9, RED, pose='wide')
    arrow(d, (360, H * 0.55), (W - 300, H * 0.55), fill=YELLOW)
    player(d, W - 200, H * 0.95, BLUE, pose='stand', number=7)
    text(d, (W / 2, 130), 'GIVE IT UP', size=80, fill=RED, shadow=WHITE, anchor='mm')


# -- the Climb's props (2026-10-20) ------------------------------------------
def flame(d, c, r=60):
    """A cartoon flame: red outside, orange, yellow core."""
    x, y = c
    for k, col in ((1.0, RED), (0.7, ORANGE), (0.42, YELLOW)):
        rr = r * k
        pts = [(x - rr, y), (x - rr * 0.8, y - rr * 0.9), (x - rr * 0.35, y - rr * 0.6), (x - rr * 0.2, y - rr * 1.7),
               (x + rr * 0.2, y - rr * 0.8), (x + rr * 0.55, y - rr * 1.35), (x + rr * 0.8, y - rr * 0.5), (x + rr, y),
               (x + rr * 0.6, y + rr * 0.45), (x - rr * 0.6, y + rr * 0.45)]
        poly(d, pts, fill=col, width=4)


def flask(d, x, y, fill=GREEN):
    """A lab flask sitting on (x, y), bubbling."""
    poly(d, [(x - 30, y - 200), (x + 30, y - 200), (x + 30, y - 130), (x + 110, y), (x - 110, y), (x - 30, y - 130)], fill=WHITE, width=6)
    poly(d, [(x - 64, y - 75), (x + 64, y - 75), (x + 102, y - 8), (x - 102, y - 8)], fill=fill, width=4)
    for bx, by, br in ((-20, -230, 14), (18, -262, 18), (-6, -305, 22)):
        circle(d, (x + bx, y + by), br, fill=fill, width=4)


def barbell(d, x, y, w=330):
    """A barbell held level at (x, y), two plates a side."""
    line(d, (x - w / 2, y), (x + w / 2, y), fill=GREY, width=12)
    for s2 in (-1, 1):
        for k, hh in ((0, 120), (26, 90)):
            px = x + s2 * (w / 2 - 30 - k)
            poly(d, [(px - 12, y - hh / 2), (px + 12, y - hh / 2), (px + 12, y + hh / 2), (px - 12, y + hh / 2)], fill=BLACK if k == 0 else GREY, width=4)


def stopwatch(d, c, r=70):
    circle(d, c, r, fill=WHITE, width=6)
    poly(d, [(c[0] - 14, c[1] - r - 30), (c[0] + 14, c[1] - r - 30), (c[0] + 14, c[1] - r), (c[0] - 14, c[1] - r)], fill=GREY, width=4)
    line(d, c, (c[0], c[1] - r * 0.7), width=6)
    line(d, c, (c[0] + r * 0.5, c[1] + r * 0.2), fill=RED, width=5)


def drop(d, c, r=18, fill=BLUE):
    """A water drop (or a bead of sweat)."""
    x, y = c
    poly(d, [(x, y - r * 2), (x + r, y), (x + r * 0.7, y + r * 0.7), (x, y + r), (x - r * 0.7, y + r * 0.7), (x - r, y)], fill=fill, width=3)


def door(d, x, y, w=210, h=330):
    """A shut door standing on (x, y), with a CLOSED sign."""
    poly(d, [(x - w / 2, y - h), (x + w / 2, y - h), (x + w / 2, y), (x - w / 2, y)], fill=BROWN, width=7)
    for k in (0.12, 0.55):
        poly(d, [(x - w / 2 + 25, y - h + h * k), (x + w / 2 - 25, y - h + h * k), (x + w / 2 - 25, y - h + h * (k + 0.33)), (x - w / 2 + 25, y - h + h * (k + 0.33))], width=4)
    circle(d, (x + w / 2 - 30, y - h / 2), 12, fill=GOLD, width=4)
    poly(d, [(x - 80, y - h - 70), (x + 80, y - h - 70), (x + 80, y - h - 10), (x - 80, y - h - 10)], fill=WHITE, width=5)
    text(d, (x, y - h - 40), 'CLOSED', size=36, fill=RED, shadow=None, anchor='mm')


def thermometer(d, x, y, h=240):
    poly(d, [(x - 22, y - h), (x + 22, y - h), (x + 22, y - 40), (x - 22, y - 40)], fill=WHITE, width=5)
    poly(d, [(x - 10, y - h * 0.9), (x + 10, y - h * 0.9), (x + 10, y - 40), (x - 10, y - 40)], fill=RED, width=3)
    circle(d, (x, y - 20), 40, fill=RED, width=5)


def calendar(d, x, y, label='NEXT'):
    poly(d, [(x - 95, y - 110), (x + 95, y - 110), (x + 95, y + 100), (x - 95, y + 100)], fill=WHITE, width=6)
    poly(d, [(x - 95, y - 110), (x + 95, y - 110), (x + 95, y - 55), (x - 95, y - 55)], fill=RED, width=6)
    text(d, (x, y - 82), label, size=34, fill=WHITE, shadow=None, anchor='mm')
    text(d, (x, y + 25), 'G2', size=70, fill=BLACK, shadow=None, anchor='mm')


def tub(d, x, y, w=420):
    """An ice tub standing on (x, y): a steel tub, ice cubes on top."""
    poly(d, [(x - w / 2, y - 190), (x + w / 2, y - 190), (x + w / 2 - 30, y), (x - w / 2 + 30, y)], fill=GREY, width=7)
    poly(d, [(x - w / 2 + 10, y - 200), (x + w / 2 - 10, y - 200), (x + w / 2 - 10, y - 170), (x - w / 2 + 10, y - 170)], fill=(170, 220, 255), width=4)
    for i in range(6):
        cx = x - w / 2 + 50 + i * (w - 100) / 5
        cy = y - 205 - (i % 2) * 14
        poly(d, [(cx - 22, cy - 22), (cx + 22, cy - 22), (cx + 22, cy + 22), (cx - 22, cy + 22)], fill=WHITE, outline=BLUE, width=4)


def speed_lines(d, x, y, n=3, length=110, fill=BLACK):
    """Motion lines trailing to the left of (x, y)."""
    for i in range(n):
        yy = y + (i - (n - 1) / 2) * 34
        line(d, (x - 30, yy), (x - 30 - length, yy), fill=fill, width=6)


# -- the Climb's scenes (2026-10-20; the user: "Draft art for all cards without it") --
def s_chemistry(d, s):
    # CHEMISTRY: every screen builds on the last one -- two teammates who have
    # it, and a flask that bubbles +1, +2, +3.
    court(d)
    screen_wall(d, W / 2 - 300, H * 0.94)
    player(d, W / 2 - 160, H * 0.94, BLUE, pose='hug', number=4)
    player(d, W / 2 + 30, H * 0.94, BLUE, pose='wave', number=11)
    flask(d, W - 300, 470)
    for i, (tx, ty) in enumerate(((W - 420, 250), (W - 300, 190), (W - 170, 130))):
        text(d, (tx, ty), '+%d' % (i + 1), size=46 + i * 10, fill=GREEN, anchor='mm')


def s_let_it_fly(d, s):
    # LET IT FLY: a shot from way back, the ball sprouting wings on the way.
    court(d)
    player(d, 170, H * 0.95, BLUE, pose='shoot', number=30)
    for i in range(6):
        t = (i + 1) / 8
        x = 240 + (W / 2 - 240) * t
        y = H * 0.95 - 360 - math.sin(t * math.pi) * 230 + t * 60
        circle(d, (x, y), 6, fill=BLACK, width=2)
    bx, by = W / 2 - 60, 250
    ball(d, (bx, by), r=36)
    for s2 in (-1, 1):
        poly(d, [(bx + 30 * s2, by - 10), (bx + 110 * s2, by - 70), (bx + 95 * s2, by - 20), (bx + 120 * s2, by - 10), (bx + 40 * s2, by + 18)], fill=WHITE, width=4)
    text(d, (W - 330, 230), '+1', size=90, fill=GREEN, anchor='mm')


def s_pace_and_space(d, s):
    # PACE AND SPACE: everybody spread to the arc and moving.
    court(d)
    spots = ((150, 0.80), (340, 0.66), (W / 2, 0.60), (W - 340, 0.66), (W - 150, 0.80))
    for i, (x, fy) in enumerate(spots):
        player(d, x, H * fy + 120, BLUE, h=200, pose='run', number=i + 1)
        speed_lines(d, x - 60, H * fy - 40, n=2, length=60)
    ball(d, (W / 2 + 80, H * 0.60 - 40), r=24)
    text(d, (W / 2, 120), '+1 SPEED', size=64, fill=GREEN, anchor='mm')


def s_bruise_brothers(d, s):
    # BRUISE BROTHERS: two bigs in the paint, flexing; the paint is theirs.
    court(d)
    player(d, W / 2 - 150, H * 0.95, BLUE, h=290, pose='flex', number=50)
    player(d, W / 2 + 150, H * 0.95, BLUE, h=300, pose='flex', number=33)
    for (x, y) in ((W / 2 - 330, 300), (W / 2 + 330, 290)):
        burst(d, (x, y), 46, fill=YELLOW)
        text(d, (x, y), 'POW', size=26, shadow=None, anchor='mm')
    text(d, (W / 2, 110), '+1 PAINT', size=60, fill=GREEN, anchor='mm')


def s_weight_room(d, s):
    # WEIGHT ROOM: one player, one barbell, three more Power.
    d.rectangle([0, 0, W, H], fill=(220, 220, 230))
    d.rectangle([0, H * 0.78, W, H], fill=GREY)
    for i in range(4):
        line(d, (0, 120 + i * 140), (W, 120 + i * 140), fill=(190, 190, 205), width=4, amt=1)
    x, y = W / 2 - 80, H * 0.97
    player(d, x, y, BLUE, h=300, pose='arms_up', number=13)
    barbell(d, x, y - 300 + 30 - 120 + 5)
    for (dx, dy) in ((-70, -275), (72, -290)):
        drop(d, (x + dx, y + dy), r=12)
    text(d, (W - 260, 260), '+3', size=110, fill=RED, anchor='mm')
    text(d, (W - 260, 360), 'POWER', size=50, fill=BLACK, anchor='mm')


def s_conditioning(d, s):
    # CONDITIONING: run all day; the battery never moves off full.
    court(d)
    player(d, W / 2 - 220, H * 0.95, BLUE, pose='run', number=8)
    speed_lines(d, W / 2 - 320, H * 0.95 - 160, n=3)
    drop(d, (W / 2 - 150, H * 0.95 - 270), r=12)
    battery(d, W / 2 + 190, 230)
    stopwatch(d, (W - 230, 500), 70)
    text(d, (W / 2 + 190, 340), 'FULL', size=46, fill=GREEN, anchor='mm')


def s_shut_the_door(d, s):
    # SHUT THE DOOR: the paint has a door now, and it is shut.
    court(d)
    door(d, W / 2, H * 0.86)
    player(d, W / 2 - 300, H * 0.95, RED, pose='dive', number=6)
    ball(d, (W / 2 - 150, H * 0.95 - 230), r=26)
    burst(d, (W / 2 - 115, H * 0.95 - 150), 40, fill=YELLOW)
    player(d, W / 2 + 250, H * 0.95, BLUE, pose='wide', number=12)
    text(d, (W / 2 + 340, 230), '-1', size=90, fill=RED, anchor='mm')


def s_stay_hot(d, s):
    # STAY HOT: the fire comes along to the next game.
    court(d)
    x = W / 2 - 220
    player(d, x, H * 0.95, BLUE, pose='arms_up', number=35)
    flame(d, (x, H * 0.95 - 220 - 10), 52)
    thermometer(d, 140, 500)
    arrow(d, (x + 150, 330), (W - 360, 330), fill=ORANGE, width=10)
    calendar(d, W - 230, 340)
    flame(d, (W - 230, 520), 40)


def s_ice_bath(d, s):
    # ICE BATH: after the game, into the tub; the legs come back fresh.
    court(d, floor=(225, 235, 245), sky=(210, 235, 255))
    x, y = W / 2 - 60, H * 0.95
    circle(d, (x, y - 300), 34, fill=PINK, width=5)
    d.ellipse([x - 12, y - 308, x - 6, y - 302], fill=BLACK)
    d.ellipse([x + 6, y - 308, x + 12, y - 302], fill=BLACK)
    line(d, (x - 12, y - 284), (x + 12, y - 284), width=3)
    tub(d, x, y)
    for (sx, sy) in ((170, 170), (330, 260), (W - 380, 210)):
        snowflake(d, (sx, sy), 40)
    text(d, (x + 220, y - 360), 'BRRR', size=58, fill=BLUE, anchor='mm')
    battery(d, W - 210, 520)


def s_splash(d, s):
    # SPLASH: threes keep falling and the net throws water; the more that go
    # in, the bigger the splash.
    court(d)
    player(d, 190, H * 0.95, BLUE, pose='shoot', number=30)
    for (bx, by) in ((W / 2 - 40, 200), (W / 2 + 40, 160), (W / 2, 120)):
        ball(d, (bx, by), r=24)
    for k in range(9):
        a = math.radians(200 + k * 17)
        drop(d, (W / 2 + 160 * math.cos(a), H * 0.44 + 60 - 120 * math.sin(a)), r=16)
    text(d, (W - 260, 250), 'SPLASH!', size=70, fill=BLUE, anchor='mm')
    for i, label in enumerate(('+1', '+2', '+3')):
        text(d, (W - 320 + i * 90, 360), label, size=40 + i * 6, fill=GREEN, anchor='mm')


def s_on_fire(d, s):
    # ON FIRE: three in a row and the ball (and the shooter) catch fire.
    court(d, sky=(255, 220, 190))
    x = W / 2 - 180
    player(d, x, H * 0.95, BLUE, h=260, pose='shoot', number=3)
    flame(d, (x, H * 0.95 - 260 - 6), 50)
    bx, by = x + 110, H * 0.95 - 420
    flame(d, (bx - 30, by + 30), 34)
    ball(d, (bx, by), r=30)
    for i in range(3):
        text(d, (W - 380 + i * 95, 200), 'O', size=64, fill=GREEN, anchor='mm')
    text(d, (W - 285, 300), 'ON FIRE!', size=60, fill=RED, anchor='mm')


# -- the Climb's wave two (2026-10-20; the user: "I love 'em, go for all") ----
def stop_sign(d, c, r=80, label='STOP'):
    pts = [(c[0] + r * math.cos(math.radians(22.5 + 45 * i)), c[1] + r * math.sin(math.radians(22.5 + 45 * i))) for i in range(8)]
    poly(d, pts, fill=RED, width=6)
    text(d, c, label, size=int(r * 0.5), fill=WHITE, shadow=None, anchor='mm')
    line(d, (c[0], c[1] + r), (c[0], c[1] + r + 170), fill=GREY, width=10)


def bubble(d, x, y, label, w=230, h=100, tail=(-60, 90)):
    """A speech bubble centred on (x, y), its tail pointing down-left."""
    pts = [(x + w / 2 * math.cos(t), y + h / 2 * math.sin(t)) for t in [i * math.pi / 12 for i in range(24)]]
    poly(d, pts, fill=WHITE, width=5)
    poly(d, [(x - 30, y + h / 2 - 6), (x + 10, y + h / 2 - 6), (x + tail[0], y + tail[1])], fill=WHITE, width=5)
    text(d, (x, y), label, size=int(h * 0.42), fill=BLACK, shadow=None, anchor='mm')


def tv(d, x, y, w=380, h=250):
    """A film-room TV on a cart, an X-and-O play on the screen."""
    poly(d, [(x - w / 2, y - h), (x + w / 2, y - h), (x + w / 2, y), (x - w / 2, y)], fill=GREY, width=7)
    poly(d, [(x - w / 2 + 22, y - h + 22), (x + w / 2 - 22, y - h + 22), (x + w / 2 - 22, y - 22), (x - w / 2 + 22, y - 22)], fill=(40, 120, 60), width=4)
    for i, (sx, sy) in enumerate([(-110, -170), (-30, -110), (60, -170), (110, -80)]):
        if i % 2:
            circle(d, (x + sx, y + sy), 16, outline=WHITE, width=4)
        else:
            line(d, (x + sx - 14, y + sy - 14), (x + sx + 14, y + sy + 14), fill=WHITE, width=4)
            line(d, (x + sx - 14, y + sy + 14), (x + sx + 14, y + sy - 14), fill=WHITE, width=4)
    arrow(d, (x - 110, y - 150), (x + 40, y - 90), fill=YELLOW, width=4)
    line(d, (x - w / 2 + 40, y), (x - w / 2 + 40, y + 120), width=8)
    line(d, (x + w / 2 - 40, y), (x + w / 2 - 40, y + 120), width=8)


def minicard(d, x, y, fill=NAVY, tilt=0):
    """A strategy card, drawn small."""
    w, h = 90, 130
    pts = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
    a = math.radians(tilt)
    pts = [(x + px * math.cos(a) - py * math.sin(a), y + px * math.sin(a) + py * math.cos(a)) for px, py in pts]
    poly(d, pts, fill=fill, width=5)
    star(d, (x, y), 22, fill=GOLD)


def s_get_stops(d, s):
    # GET STOPS: the defense says no, and the board is yours.
    court(d)
    stop_sign(d, (220, 260), 90)
    player(d, W / 2 - 60, H * 0.95, BLUE, pose='wide', number=3)
    player(d, W / 2 + 220, H * 0.95, RED, pose='stand', number=9)
    ball(d, (W / 2 + 80, H * 0.95 - 330), r=28)
    arrow(d, (W / 2 + 70, H * 0.95 - 300), (W / 2 - 40, H * 0.95 - 380), fill=GREEN, width=7)
    text(d, (W - 260, 300), '+1 REB', size=70, fill=GREEN, anchor='mm')


def s_talk_on_defense(d, s):
    # TALK ON DEFENSE: "SWITCH!" -- the call that keeps everyone a step quicker.
    court(d)
    player(d, W / 2 - 260, H * 0.95, BLUE, pose='wide', number=4)
    player(d, W / 2 + 120, H * 0.95, BLUE, pose='wave', number=11)
    bubble(d, W / 2 - 230, 250, 'SWITCH!', w=280, h=110, tail=(-40, 120))
    bubble(d, W / 2 + 260, 210, 'GOT IT!', w=250, h=100, tail=(-80, 120))
    speed_lines(d, W / 2 - 330, H * 0.95 - 120, n=3, length=90)
    text(d, (W - 170, 420), '+1', size=90, fill=GREEN, anchor='mm')


def s_ball_movement(d, s):
    # BALL MOVEMENT: three passes, one open three.
    court(d)
    a, b, c = (W / 2 - 360, H * 0.95), (W / 2 + 40, H * 0.82), (W / 2 + 360, H * 0.95)
    player(d, a[0], a[1], BLUE, pose='stand', number=1)
    player(d, b[0], b[1], BLUE, pose='stand', number=2)
    player(d, c[0], c[1], BLUE, pose='shoot', number=3)
    arrow(d, (a[0] + 60, a[1] - 190), (b[0] - 60, b[1] - 200), fill=ORANGE, width=6)
    arrow(d, (b[0] + 60, b[1] - 200), (c[0] - 60, c[1] - 190), fill=ORANGE, width=6)
    ball(d, (c[0] + 60, c[1] - 360), r=26)
    text(d, (W / 2 + 40, 170), '+1 AST', size=72, fill=GREEN, anchor='mm')


def s_wear_them_down(d, s):
    # WEAR THEM DOWN: every bucket inside leans on the same tired defender.
    court(d)
    player(d, W / 2 - 120, H * 0.95, BLUE, pose='back', number=34, h=250)
    player(d, W / 2 + 80, H * 0.95, RED, pose='box', number=8, h=200)
    for k, (dx, dy) in enumerate(((150, -230), (200, -180), (120, -170))):
        drop(d, (W / 2 + dx, H * 0.95 + dy), r=12)
    ball(d, (W / 2 - 200, H * 0.95 - 170), r=26)
    battery(d, W - 250, 230)
    text(d, (W - 250, 350), '-1 PWR', size=56, fill=RED, anchor='mm')


def s_film_session(d, s):
    # FILM SESSION: the coach's tape, a new card every section.
    court(d)
    tv(d, W / 2 + 130, H * 0.62)
    player(d, W / 2 - 330, H * 0.95, BLUE, pose='sit', number=0)
    minicard(d, W / 2 - 330, 230, tilt=-12)
    text(d, (W / 2 - 200, 200), '+1', size=80, fill=GREEN, anchor='mm')


def s_signature_set(d, s):
    # SIGNATURE SET: the play the team runs better every game.
    court(d)
    clipboard(d, 230, 380)
    star(d, (230, 200), 50, fill=GOLD)
    player(d, W / 2 + 120, H * 0.95, BLUE, pose='shoot', number=30)
    ball(d, (W / 2 + 190, H * 0.95 - 390), r=28)
    text(d, (W - 230, 260), '+2', size=70, fill=GREEN, anchor='mm')
    arrow(d, (W - 230, 320), (W - 230, 430), fill=GREEN, width=6)
    text(d, (W - 230, 490), '+6', size=80, fill=GREEN, anchor='mm')


def s_leave_it_all(d, s):
    # LEAVE IT ALL OUT THERE: diving on the floor for everything, once.
    court(d)
    player(d, W / 2 - 40, H * 0.97, BLUE, pose='dive', number=5)
    ball(d, (W / 2 + 160, H * 0.97 - 190), r=28)
    burst(d, (W / 2 + 160, H * 0.97 - 190), 70, fill=YELLOW)
    ball(d, (W / 2 + 160, H * 0.97 - 190), r=28)
    for dx in (-150, -90, -20):
        drop(d, (W / 2 + dx, H * 0.97 - 300), r=13)
    text(d, (W / 2, 160), 'ALL IN', size=96, fill=RED, anchor='mm')
    text(d, (W - 220, 360), '+3', size=90, fill=GREEN, anchor='mm')


def s_up_tempo(d, s):
    # UP-TEMPO: push it -- more trips, more plays, more running.
    court(d)
    x = W / 2 - 140
    player(d, x, H * 0.95, BLUE, pose='run', number=2)
    speed_lines(d, x - 90, H * 0.95 - 170, n=4)
    ball(d, (x + 110, H * 0.95 - 140), r=26)
    arrow(d, (x + 160, 330), (W - 330, 330), fill=ORANGE, width=10)
    minicard(d, W - 260, 470, tilt=-10)
    minicard(d, W - 170, 480, tilt=12)
    stopwatch(d, (210, 260), 64)
    drop(d, (x + 40, H * 0.95 - 290), r=12)


def s_ride_your_star(d, s):
    # RIDE YOUR STAR: the coach leaves the best player in, tired or not.
    court(d)
    x = W / 2 + 40
    player(d, x, H * 0.95, BLUE, pose='arms_up', number=23, h=250)
    star(d, (x, H * 0.95 - 330), 60, fill=GOLD)
    for dx in (-90, 90):
        drop(d, (x + dx, H * 0.95 - 250), r=13)
    bench(d, 230, H * 0.92, w=260)
    text(d, (230, H * 0.92 - 90), 'nope', size=44, fill=GREY, anchor='mm')
    text(d, (W - 200, 360), '+4', size=96, fill=GREEN, anchor='mm')


def s_full_court_press(d, s):
    # FULL-COURT PRESS: three hands up across the whole floor.
    court(d)
    for k, x in enumerate((W / 2 - 360, W / 2, W / 2 + 360)):
        player(d, x, H * 0.95 - (k % 2) * 40, BLUE, pose='wide', number=(10, 21, 32)[k])
        drop(d, (x + 60, H * 0.95 - (k % 2) * 40 - 270), r=11)
    arrow(d, (W / 2 - 300, 300), (W / 2 + 300, 300), fill=RED, width=8)
    text(d, (W / 2, 210), 'PRESS!', size=80, fill=RED, anchor='mm')


def s_crash_every_board(d, s):
    # CRASH EVERY BOARD: everybody goes to the glass.
    court(d)
    ball(d, (W / 2 + 30, H * 0.40 - 170), r=30)
    player(d, W / 2 - 160, H * 0.95, BLUE, pose='arms_up', number=50, h=250)
    player(d, W / 2 + 200, H * 0.95, BLUE, pose='arms_up', number=44, h=250)
    player(d, W / 2 + 20, H * 0.98, RED, pose='box', number=7, h=190)
    text(d, (200, 260), '+3 REB', size=64, fill=GREEN, anchor='mm')


def s_play_through_contact(d, s):
    # PLAY THROUGH CONTACT: the bump, and the bucket anyway.
    court(d)
    player(d, W / 2 - 60, H * 0.95, BLUE, pose='shoot', number=21, h=240)
    player(d, W / 2 + 120, H * 0.95, RED, pose='box', number=12)
    burst(d, (W / 2 + 40, H * 0.95 - 170), 60, fill=YELLOW)
    text(d, (W / 2 + 40, H * 0.95 - 170), 'BAM', size=34, fill=RED, shadow=None, anchor='mm')
    ball(d, (W / 2 + 10, H * 0.95 - 410), r=28)
    flame(d, (210, 330), 50)
    text(d, (W - 220, 300), '+3', size=90, fill=GREEN, anchor='mm')


def s_two_a_days(d, s):
    # TWO-A-DAYS: practice twice; better and more tired.
    court(d)
    calendar(d, 210, 360, label='x2')
    player(d, W / 2 + 60, H * 0.95, BLUE, pose='flex', number=6)
    barbell(d, W / 2 + 60, H * 0.95 - 340, w=300)
    for dx in (-110, 110):
        drop(d, (W / 2 + 60 + dx, H * 0.95 - 250), r=13)
    circle(d, (W - 220, 300), 70, fill=GOLD, width=6)
    text(d, (W - 220, 300), '+', size=110, fill=NAVY, shadow=None, anchor='mm')


def s_bad_contract(d, s):
    # BAD CONTRACT (2026-10-25): Summer-League Tape's price. A deal nobody
    # wanted, stamped VOID, its player parked at the end of the bench.
    court(d)
    bench(d, W - 260, H * 0.95 - 210 * 0.42 + 40, w=320)
    player(d, W - 260, H * 0.95, GREY, h=210, pose='sit', number=0)
    # The contract: a sheet with its lines, the money, and a scrawl.
    x0, y0 = 150, 150
    poly(d, [(x0, y0 + 30), (x0 + 430, y0), (x0 + 470, y0 + 560), (x0 + 40, y0 + 590)], fill=WHITE, width=6)
    text(d, (x0 + 235, y0 + 90), 'CONTRACT', size=54, fill=BLACK, shadow=None, anchor='mm')
    for k in range(5):
        yy = y0 + 170 + k * 62
        line(d, (x0 + 70, yy + 8 - k * 2), (x0 + 400, yy - 14 - k * 2), width=4, amt=2)
    text(d, (x0 + 250, y0 + 480), '$$$$', size=70, fill=GREEN, shadow=None, anchor='mm')
    # The stamp, across it.
    poly(d, [(x0 + 40, y0 + 250), (x0 + 450, y0 + 200), (x0 + 465, y0 + 330), (x0 + 55, y0 + 380)], outline=RED, width=12, amt=2)
    text(d, (x0 + 252, y0 + 290), 'VOID', size=110, fill=RED, shadow=None, anchor='mm')


SCENES = {
    'bad_contract': s_bad_contract,
    'blitz': s_blitz,
    'kick_out_three': s_kick_out_three, 'grab_and_go': s_grab_and_go,
    'rebound_and_push': s_rebound_and_push, 'own_the_glass': s_own_the_glass,
    'double_team': s_double_team, 'pick_up_full_court': s_pick_up_full_court, 'cross_court_dime': s_cross_court_dime,
    'desperation_press': s_desperation_press, 'second_closer': s_second_closer, 'ato_masterpiece': s_ato_masterpiece,
    'fresh_legs': s_fresh_legs, 'ice_the_hot_hand': s_ice_the_hot_hand, 'reset': s_reset,
    'spain_pick_roll': s_spain, 'mismatch_hunter': s_mismatch, 'strength_in_numbers': s_strength,
    'energizer': s_energizer, 'defensive_identity': s_identity, 'defensive_anchor': s_anchor,
    'swarming_defense': s_swarm, 'five_out': s_five_out, 'hammer_set': s_hammer, 'iso_heavy': s_iso,
    'three_point_barrage': s_barrage, 'crash_and_kick': s_crash_kick, 'pick_and_pop': s_pick_pop,
    'extra_pass': s_extra_pass, 'lob_city': s_lob_city, 'stretch_five': s_stretch_five,
    'post_domination': s_post_domination, 'unsung_hero': s_unsung_hero, 'transition_outlet': s_transition_outlet,
    'find_the_open_man': s_open_man, 'putback_specialist': s_putback_specialist, 'rim_protector': s_rim_protector,
    'drop_coverage': s_drop_coverage, 'smothering_defense': s_smothering, 'denial': s_denial,
    'hustle_play': s_hustle, 'glass_cleaner': s_glass_cleaner, 'box_out': s_box_out,
    'hack_a': s_hack_a, 'foul_trouble': s_foul_trouble,
    # The Climb's own cards (2026-10-20).
    'chemistry': s_chemistry, 'let_it_fly': s_let_it_fly, 'pace_and_space': s_pace_and_space,
    'bruise_brothers': s_bruise_brothers, 'weight_room': s_weight_room, 'conditioning': s_conditioning,
    'shut_the_door': s_shut_the_door, 'stay_hot': s_stay_hot, 'ice_bath': s_ice_bath,
    'splash': s_splash, 'on_fire': s_on_fire,
    # Wave two (2026-10-20).
    'get_stops': s_get_stops, 'talk_on_defense': s_talk_on_defense, 'ball_movement': s_ball_movement,
    'wear_them_down': s_wear_them_down, 'film_session': s_film_session, 'signature_set': s_signature_set,
    'leave_it_all': s_leave_it_all, 'up_tempo': s_up_tempo, 'ride_your_star': s_ride_your_star,
    'full_court_press': s_full_court_press, 'crash_every_board': s_crash_every_board,
    'play_through_contact': s_play_through_contact, 'two_a_days': s_two_a_days,
}


def strats():
    """The strats registry, read the way the studio reads it — from strats.js."""
    import re
    src = open(os.path.join(ROOT, 'src', 'game', 'strats.js'), encoding='utf8').read()
    out = []
    for m in re.finditer(r"\{\s*id:\s*'([a-z0-9_]+)',\s*name:\s*'((?:[^'\\]|\\.)*)'", src):
        out.append({'id': m.group(1), 'name': m.group(2).replace("\\'", "'")})
    return out


def is_placeholder(path):
    try:
        with Image.open(path) as im:
            return im.info.get('showdown') == MARKER
    except Exception:
        return False


def draw(strat):
    rng.seed(strat['id'])
    im = Image.new('RGB', (W, H), WHITE)
    d = ImageDraw.Draw(im)
    SCENES.get(strat['id'], s_generic)(d, strat)
    caption(d, strat['name'])
    # the corner signature every placeholder carries
    text(d, (14, 10), 'placeholder', size=26, fill=GREY, shadow=None, bold=False)
    return im


def save(im, path):
    meta = PngImagePlugin.PngInfo()
    meta.add_text('showdown', MARKER)
    im.save(path, 'PNG', pnginfo=meta)


def main(argv):
    everything = '--all' in argv
    names = [a for a in argv if not a.startswith('--')]
    faces = {f.rsplit('.', 1)[0] for f in os.listdir(FACES)} if os.path.isdir(FACES) else set()
    os.makedirs(PHOTOS, exist_ok=True)
    have = {f.rsplit('.', 1)[0]: f for f in os.listdir(PHOTOS) if not f.startswith('_')}
    manifest = set(json.load(open(MANIFEST, encoding='utf8'))) if os.path.exists(MANIFEST) else set()
    written = []
    for s in strats():
        sid = s['id']
        if names and sid not in names:
            continue
        if everything:
            os.makedirs(PREVIEW, exist_ok=True)
            save(draw(s), os.path.join(PREVIEW, sid + '.png'))
            written.append(sid)
            continue
        # A hand-made face in public/cards/strats/ is what the GAME shows; the
        # STUDIO composes from strats.js and reads only the photos folder, so
        # without a placeholder here those cards read "NO ART" in the studio
        # (the user, 2026-09-06: "I'm not seeing placeholder art for all the
        # strats in studio"). The placeholder never reaches the game for these:
        # the exporter's --missing skips a face that exists, and the Photo Hunt
        # lists only the composed cards.
        if sid in have and not is_placeholder(os.path.join(PHOTOS, have[sid])):
            manifest.discard(sid)  # a real photo replaced the placeholder
            continue
        save(draw(s), os.path.join(PHOTOS, sid + '.png'))
        manifest.add(sid)
        written.append(sid)
    # any manifest entry whose file is no longer ours is a real photo now
    for sid in list(manifest):
        f = have.get(sid) or (sid + '.png')
        p = os.path.join(PHOTOS, f)
        if not os.path.exists(p) or not is_placeholder(p):
            manifest.discard(sid)
    if not everything:
        json.dump(sorted(manifest), open(MANIFEST, 'w', encoding='utf8'), indent=2)
    print(f"{len(written)} placeholder(s) drawn{' to ' + PREVIEW if everything else ''}; manifest {len(manifest)}")
    for sid in written:
        print('  ', sid)


if __name__ == '__main__':
    main(sys.argv[1:])
