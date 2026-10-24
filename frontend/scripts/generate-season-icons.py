#!/usr/bin/env python3
"""
Draws the 21 Long Season item icons (shared/sim/season.ts SEASON_ITEMS) into
frontend/public/items/season/<id>.png, 128x128 like the other item icons.

Each icon is a few flat "sticker" parts: a dark rounded outline, a base fill,
a darker crescent on the lower right, a lighter one on the upper left and the
odd sparkle. Everything is drawn at 4x and downsampled for antialiasing.
Deterministic; needs only Pillow. Run: python3 frontend/scripts/generate-season-icons.py
"""
import math
import os
from PIL import Image, ImageChops, ImageDraw, ImageFilter

SIZE, K = 128, 4
W = SIZE * K
INK = (43, 34, 51, 255)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'public', 'items', 'season')


def rgb(hex_: str):
    hex_ = hex_.lstrip('#')
    return tuple(int(hex_[i:i + 2], 16) for i in (0, 2, 4))


def mix(c, d, t):
    return tuple(round(a + (b - a) * t) for a, b in zip(c, d))


def dark(c, t=0.28):
    return mix(c, (40, 20, 50), t)


def light(c, t=0.45):
    return mix(c, (255, 255, 255), t)


def S(*v):
    return [x * K for x in v]


def P(pts):
    return [(x * K, y * K) for x, y in pts]


def mask():
    return Image.new('L', (W, W), 0)


def ell(x0, y0, x1, y1):
    m = mask(); ImageDraw.Draw(m).ellipse(S(x0, y0, x1, y1), fill=255); return m


def poly(pts):
    m = mask(); ImageDraw.Draw(m).polygon(P(pts), fill=255); return m


def rrect(x0, y0, x1, y1, r):
    m = mask(); ImageDraw.Draw(m).rounded_rectangle(S(x0, y0, x1, y1), radius=r * K, fill=255); return m


def stroke(pts, width):
    """A thick polyline with round joints and ends."""
    m = mask(); d = ImageDraw.Draw(m); w = width * K
    d.line(P(pts), fill=255, width=round(w), joint='curve')
    for x, y in pts:
        d.ellipse([x * K - w / 2, y * K - w / 2, x * K + w / 2, y * K + w / 2], fill=255)
    return m


def union(*ms):
    out = ms[0]
    for m in ms[1:]:
        out = ImageChops.lighter(out, m)
    return out


def minus(a, b):
    return ImageChops.subtract(a, b)


def inter(a, b):
    return ImageChops.multiply(a, b)


def _shift(m, dx, dy):
    out = mask(); out.paste(m, (round(dx * K), round(dy * K))); return out


def grow(m, px):
    if px <= 0:
        return m
    return m.filter(ImageFilter.GaussianBlur(px * K * 0.55)).point(lambda v: 255 if v > 24 else 0)


def star_pts(cx, cy, outer, inner, points=5, rot=-math.pi / 2):
    return [(cx + math.cos(rot + math.pi * i / points) * (outer if i % 2 == 0 else inner),
             cy + math.sin(rot + math.pi * i / points) * (outer if i % 2 == 0 else inner)) for i in range(points * 2)]


def hexagon(cx, cy, r):
    return [(cx + math.cos(math.pi / 3 * i) * r, cy + math.sin(math.pi / 3 * i) * r) for i in range(6)]


class Icon:
    def __init__(self):
        self.img = Image.new('RGBA', (W, W), (0, 0, 0, 0))

    def fill(self, m, color, alpha=255):
        self.img.paste(tuple(color[:3]) + (alpha,), mask=m if alpha == 255 else m.point(lambda v: v * alpha // 255))

    def part(self, m, base, outline=3.2, shade=0.28, hi=0.45, depth=5, sheen=True):
        base = rgb(base) if isinstance(base, str) else base
        if outline:
            self.fill(grow(m, outline), INK)
        self.fill(m, base)
        if shade:
            self.fill(minus(m, _shift(m, -depth, -depth)), dark(base, shade))
        if hi and sheen:
            self.fill(minus(inter(m, _shift(m, depth * 0.8, depth * 0.8)), _shift(m, depth * 0.4, depth * 0.4)), light(base, hi))
        return m

    def flat(self, m, color, alpha=255):
        self.fill(m, rgb(color) if isinstance(color, str) else color, alpha)

    def glow(self, m, color, radius=8, alpha=150):
        g = m.filter(ImageFilter.GaussianBlur(radius * K))
        self.img.alpha_composite(Image.merge('RGBA', [Image.new('L', (W, W), c) for c in rgb(color)] + [g.point(lambda v: v * alpha // 255)]))

    def sparkle(self, cx, cy, r, color='#FFF6C8'):
        m = poly(star_pts(cx, cy, r, r * 0.28, 4, 0))
        self.part(m, color, outline=2.2, shade=0, hi=0)

    def dot(self, cx, cy, r, color='#FFFFFF', alpha=230):
        self.flat(ell(cx - r, cy - r, cx + r, cy + r), color, alpha)

    def save(self, name):
        self.img.resize((SIZE, SIZE), Image.LANCZOS).save(os.path.join(OUT, f'{name}.png'), optimize=True)


# ---- Raw materials ---------------------------------------------------------------

def honeycomb(i):
    cells = [(48, 50), (80, 50), (64, 77), (32, 77), (96, 77), (48, 104)]
    comb = union(*[poly(hexagon(x, y, 17)) for x, y in cells[:5]])
    i.part(comb, '#E8B23A', depth=6)
    for x, y in cells[:5]:
        i.flat(poly(hexagon(x + 1, y + 1, 10)), '#B9781C')
        i.flat(poly(hexagon(x - 1, y - 1, 8)), '#F7CE5E')
    drip = union(ell(70, 92, 84, 108), poly([(71, 96), (83, 96), (77, 84)]))
    i.part(drip, '#F2A92A', outline=2.6, depth=3)
    i.dot(74, 98, 2.2)
    i.sparkle(108, 26, 8)


def pearl(i):
    i.part(ell(26, 26, 102, 102), '#F2EEE4', shade=0.18, depth=9)
    i.flat(minus(ell(32, 60, 96, 100), ell(26, 52, 102, 96)), '#E3D4EC', 200)
    i.dot(48, 46, 9, '#FFFFFF', 240)
    i.dot(64, 40, 3.5, '#FFFFFF', 220)
    i.sparkle(104, 24, 10)
    i.sparkle(22, 104, 7)


def glowcap(i):
    i.glow(ell(16, 14, 112, 76), '#7FF0DC', 10, 120)
    i.part(union(rrect(50, 56, 78, 112, 12), ell(46, 98, 82, 116)), '#EFE3C4', depth=4)
    cap = minus(ell(14, 18, 114, 92), rrect(0, 70, 128, 128, 0))
    cap = union(cap, rrect(14, 60, 114, 74, 7))
    i.part(cap, '#5FC9B4', depth=6)
    for x, y, r in [(38, 46, 7), (62, 32, 6), (86, 46, 7), (64, 56, 5), (100, 60, 4), (26, 62, 4)]:
        i.dot(x, y, r, '#D8FFF6', 245)
    i.sparkle(110, 18, 8, '#D8FFF6')
    i.sparkle(18, 22, 6, '#D8FFF6')


def coral(i):
    branches = [[(64, 114), (62, 80), (46, 56), (40, 30)], [(62, 80), (84, 56), (90, 28)], [(46, 56), (26, 44), (22, 26)],
                [(84, 56), (104, 50), (108, 34)], [(62, 86), (64, 50), (66, 22)]]
    m = union(*[stroke(b, 13) for b in branches], ell(46, 104, 82, 120))
    i.part(m, '#F26B6B', depth=5)
    for b in branches:
        x, y = b[-1]
        i.dot(x - 1.5, y - 1.5, 3.2, '#FFC2C2', 240)


def sunpeach(i):
    body = union(ell(18, 30, 70, 110), ell(52, 30, 110, 110), ell(26, 42, 104, 114))
    i.part(body, '#F49A5B', depth=8)
    i.flat(minus(ell(20, 32, 108, 110), ell(10, 20, 98, 102)), '#E8684A', 170)
    i.flat(stroke([(64, 38), (60, 62), (62, 92)], 3.5), '#D6703E')
    i.part(stroke([(64, 40), (68, 22)], 6), '#7A5634', outline=2.4, shade=0, hi=0)
    i.part(poly([(68, 26), (86, 10), (108, 14), (96, 30), (76, 32)]), '#6FAF4E', outline=2.6, depth=3)
    i.dot(40, 54, 6, '#FFE2B8', 200)


def amber(i):
    gem = poly([(64, 12), (96, 40), (104, 74), (86, 108), (48, 112), (24, 86), (28, 46)])
    i.part(gem, '#E59A2C', depth=8)
    i.flat(poly([(64, 12), (64, 58), (28, 46)]), '#F4B84A')
    i.flat(poly([(64, 58), (96, 40), (104, 74)]), '#C87418')
    i.flat(poly([(64, 58), (86, 108), (48, 112)]), '#B8661A', 200)
    i.flat(poly([(46, 30), (58, 22), (52, 44)]), '#FFE2A0', 230)
    i.dot(70, 78, 4, '#7A3F10', 200)
    i.sparkle(108, 22, 8)


def starpetal(i):
    i.glow(poly(star_pts(64, 66, 54, 26)), '#FFF0A0', 10, 140)
    i.part(poly(star_pts(64, 66, 50, 22)), '#F6E7A1', depth=6)
    i.flat(poly(star_pts(64, 66, 28, 12)), '#FFF8D8', 230)
    i.part(ell(54, 56, 74, 76), '#F2B84A', outline=2.2, depth=3)
    i.sparkle(108, 20, 8)
    i.sparkle(20, 108, 6)


def moonstone(i):
    i.part(ell(18, 26, 110, 106), '#BFD4F2', depth=9)
    i.flat(minus(ell(38, 38, 82, 82), ell(48, 32, 92, 76)), '#FFFFFF', 220)
    i.flat(minus(ell(22, 70, 106, 106), ell(18, 60, 110, 100)), '#9FB8E4', 200)
    i.dot(86, 50, 4, '#FFFFFF', 220)
    i.sparkle(106, 22, 9, '#E8F0FF')


def dreamplum(i):
    body = union(ell(20, 34, 106, 114))
    i.part(body, '#8E5BD0', depth=9)
    i.flat(stroke([(62, 42), (58, 70), (62, 100)], 3.5), '#6A3FA8')
    i.part(stroke([(62, 42), (66, 22)], 6), '#6B4A2E', outline=2.4, shade=0, hi=0)
    i.part(poly([(66, 26), (90, 14), (108, 22), (90, 34)]), '#6C9A4A', outline=2.6, depth=3)
    i.dot(40, 60, 7, '#D9C2FA', 210)
    i.dot(34, 76, 3, '#D9C2FA', 200)
    i.sparkle(106, 104, 8, '#F2E6FF')


def star_iron(i):
    rock = poly([(20, 70), (30, 36), (60, 20), (96, 30), (110, 64), (98, 100), (60, 112), (28, 100)])
    i.part(rock, '#5E6E8F', depth=8)
    i.flat(poly([(30, 36), (60, 20), (64, 52), (36, 60)]), '#7F90B8')
    i.flat(poly([(64, 52), (96, 30), (110, 64), (82, 72)]), '#4B5978')
    i.flat(poly([(36, 60), (64, 52), (82, 72), (60, 112), (28, 100)]), '#55658A', 140)
    for x, y, r in [(48, 44, 7), (84, 86, 6), (66, 70, 4)]:
        i.glow(poly(star_pts(x, y, r * 1.6, r * 0.6)), '#FFF2A8', 3, 200)
        i.part(poly(star_pts(x, y, r, r * 0.42)), '#FFF2A8', outline=1.6, shade=0, hi=0)


# ---- Crafted goods ---------------------------------------------------------------

def beeswax_candle(i):
    i.part(ell(26, 98, 102, 120), '#9C8468', depth=3)
    i.part(union(rrect(40, 46, 88, 110, 6), ell(40, 38, 88, 54)), '#F1D27A', depth=7)
    i.flat(ell(44, 41, 84, 52), '#F7E2A0')
    i.part(union(ell(46, 64, 58, 80), rrect(46, 52, 58, 72, 0)), '#F1D27A', outline=0, depth=2)
    i.part(stroke([(64, 44), (64, 34)], 3), '#4A3A2A', outline=1.6, shade=0, hi=0)
    i.glow(ell(50, 4, 78, 40), '#FFC94A', 6, 160)
    flame = union(ell(55, 18, 73, 38), poly([(56, 26), (72, 26), (64, 4)]))
    i.part(flame, '#FFB43A', outline=2.4, shade=0, hi=0)
    i.flat(union(ell(59, 24, 69, 36), poly([(60, 28), (68, 28), (64, 14)])), '#FFF2B0')


def pearl_charm(i):
    i.part(stroke([(32, 20), (64, 40), (96, 20)], 4), '#8A6A45', outline=2.2, shade=0, hi=0)
    i.part(poly([(64, 46), (90, 66), (64, 118), (38, 66)]), '#5B6470', depth=6)
    i.flat(poly([(64, 46), (64, 118), (38, 66)]), '#7D8DA6', 160)
    for x in (44, 84):
        i.part(ell(x - 13, 28, x + 13, 54), '#E7E1F0', depth=4)
        i.dot(x - 4, 36, 3.5)
    i.sparkle(108, 96, 7)


def glow_lantern(i):
    i.part(stroke([(48, 26), (64, 8), (80, 26)], 5), '#9C8468', outline=2.4, shade=0, hi=0)
    i.glow(rrect(30, 32, 98, 108, 12), '#8EF0DE', 10, 160)
    i.part(rrect(28, 22, 100, 34, 5), '#9C8468', depth=3)
    i.part(rrect(28, 104, 100, 116, 5), '#9C8468', depth=3)
    i.part(rrect(36, 34, 92, 104, 6), '#8EE0D2', depth=6, shade=0.15)
    i.flat(ell(48, 50, 80, 90), '#E2FFF8', 220)
    i.flat(ell(56, 58, 72, 82), '#FFFFFF', 240)
    for x in (34, 62, 90):
        i.part(rrect(x - 3.5, 30, x + 3.5, 108, 2), '#7E6A52', outline=2, shade=0, hi=0)
    i.sparkle(112, 52, 7, '#D8FFF6')


def coral_totem(i):
    i.part(rrect(30, 96, 98, 116, 6), '#C85A55', depth=3)
    i.part(rrect(36, 66, 92, 98, 8), '#E8746E', depth=5)
    i.part(rrect(40, 38, 88, 68, 8), '#F26B6B', depth=5)
    i.part(union(stroke([(48, 40), (40, 18)], 9), stroke([(80, 40), (88, 18)], 9)), '#F58A8A', depth=3)
    for y in (52, 82):
        i.flat(ell(50, y - 4, 58, y + 4), '#5A2230')
        i.flat(ell(70, y - 4, 78, y + 4), '#5A2230')
    i.part(ell(52, 22, 76, 46), '#E7E1F0', depth=3)
    i.dot(60, 30, 3)


def sunpeach_preserves(i):
    i.part(rrect(28, 40, 100, 116, 14), '#CFE6F0', shade=0.12, depth=5)
    i.part(rrect(34, 56, 94, 110, 10), '#F0A060', outline=0, depth=5)
    i.flat(rrect(38, 56, 90, 64, 4), '#F8C48A')
    i.part(rrect(24, 24, 104, 44, 8), '#D85A4A', depth=4)
    i.flat(stroke([(26, 40), (102, 40)], 3), '#F2E6C8')
    i.part(rrect(44, 72, 84, 96, 4), '#F2E6C8', outline=2, shade=0, hi=0)
    i.dot(64, 84, 6, '#F49A5B', 255)
    i.flat(rrect(36, 66, 44, 100, 4), '#FFFFFF', 140)


def amber_inlay(i):
    i.part(poly(hexagon(64, 66, 50)), '#E8746E', depth=7)
    i.flat(poly(hexagon(64, 66, 38)), '#C85A55')
    gem = poly([(64, 38), (86, 54), (82, 84), (64, 96), (46, 84), (42, 54)])
    i.part(gem, '#E9A640', depth=5, outline=2.6)
    i.flat(poly([(64, 38), (64, 66), (42, 54)]), '#F8C870')
    i.flat(poly([(64, 66), (82, 84), (64, 96)]), '#C87418')
    i.sparkle(104, 22, 9)


def starpetal_incense(i):
    i.flat(stroke([(64, 40), (54, 28), (66, 18), (58, 6)], 4), '#E8E2F2', 170)
    for x, tilt in ((50, -10), (64, 0), (78, 10)):
        i.part(stroke([(x + tilt * 0.2, 40), (x - tilt, 112)], 5), '#8A6A45', outline=2.2, shade=0, hi=0)
    i.part(rrect(40, 52, 88, 78, 8), '#F8EBB5', depth=4)
    i.flat(rrect(40, 62, 88, 68, 0), '#C0392B')
    for x in (50, 64, 78):
        i.dot(x, 42, 3.4, '#FF9A4A', 255)
    i.part(poly(star_pts(98, 30, 14, 6)), '#F6E7A1', outline=2.2, depth=2)
    i.sparkle(26, 30, 7)


def moonstone_lens(i):
    i.part(ell(14, 14, 114, 114), '#E9A640', depth=6)
    i.part(ell(26, 26, 102, 102), '#C9DBF5', depth=7, shade=0.16, outline=2.4)
    i.flat(minus(ell(36, 34, 74, 72), ell(42, 40, 80, 78)), '#FFFFFF', 230)
    i.dot(82, 82, 4, '#FFFFFF', 200)
    i.sparkle(110, 18, 8)


def dream_tonic(i):
    body = union(ell(24, 46, 104, 120), rrect(50, 24, 78, 60, 4))
    i.part(body, '#D9E8F0', shade=0.1, depth=5)
    i.part(minus(ell(30, 52, 98, 114), rrect(0, 0, 128, 70, 0)), '#A47BE0', outline=0, depth=6)
    i.flat(ell(34, 66, 94, 76), '#C7A6F2')
    i.part(rrect(48, 10, 80, 28, 5), '#B8875A', depth=3)
    i.flat(ell(36, 74, 48, 100), '#FFFFFF', 150)
    for x, y in ((56, 92), (74, 84), (66, 102)):
        i.dot(x, y, 3, '#F2E6FF', 230)
    i.sparkle(108, 30, 8, '#F2E6FF')
    i.sparkle(20, 34, 6, '#F2E6FF')


def star_iron_ingot(i):
    top = poly([(34, 46), (94, 46), (110, 64), (18, 64)])
    front = poly([(18, 64), (110, 64), (104, 96), (24, 96)])
    i.part(union(top, front), '#7A8AAE', depth=5, sheen=False)
    i.flat(top, '#9AAACC')
    i.flat(poly([(34, 46), (94, 46), (90, 52), (38, 52)]), '#C4D0EA')
    i.flat(poly([(18, 64), (110, 64), (108, 72), (20, 72)]), '#64739A')
    i.part(poly(star_pts(64, 81, 10, 4.2)), '#FFF2A8', outline=1.8, shade=0, hi=0)
    i.sparkle(106, 26, 9)


def ledger_seal(i):
    n = 18
    rim = poly([(64 + math.cos(2 * math.pi * k / (n * 2)) * (52 if k % 2 == 0 else 46),
                 66 + math.sin(2 * math.pi * k / (n * 2)) * (52 if k % 2 == 0 else 46)) for k in range(n * 2)])
    i.part(rim, '#C0392B', depth=7)
    i.flat(ell(30, 32, 98, 100), '#A52E22')
    i.flat(minus(ell(30, 32, 98, 100), ell(34, 36, 102, 104)), '#7E2018')
    berry = union(ell(48, 54, 80, 86))
    i.part(berry, '#E0584A', outline=2.2, depth=3)
    i.part(poly([(64, 56), (78, 42), (84, 50)]), '#E0584A', outline=2.2, shade=0, hi=0)
    i.dot(58, 64, 3, '#FFB0A0', 220)
    i.sparkle(108, 20, 8)


DRAW = {f.__name__: f for f in [honeycomb, pearl, glowcap, coral, sunpeach, amber, starpetal, moonstone, dreamplum, star_iron,
                               beeswax_candle, pearl_charm, glow_lantern, coral_totem, sunpeach_preserves, amber_inlay,
                               starpetal_incense, moonstone_lens, dream_tonic, star_iron_ingot, ledger_seal]}

if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    for name, draw in DRAW.items():
        icon = Icon(); draw(icon); icon.save(name)
    print(f'wrote {len(DRAW)} icons to {os.path.normpath(OUT)}')
