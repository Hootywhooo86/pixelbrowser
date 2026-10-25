#!/usr/bin/env python3
"""Draw Bitter, Bit Browser's pixel robot mascot, as animation frames.

    python3 scripts/make-mascot.py

Writes 64px and 128px PNGs of each frame to apps/mobile/assets/bitter/ and
apps/desktop/src/ui/img/ (bitter-<frame>-<size>.png). The sprite is a 16x16
grid below: edit BASE and FRAMES to change the look (for example to match the
BitCaller robot). Colors are the Bit Browser logo palette.
"""
import os
from PIL import Image

PALETTE = {
    '.': None,                 # transparent
    'O': (11, 11, 22, 255),    # navy outline
    'T': (45, 212, 191, 255),  # teal body
    'D': (14, 124, 111, 255),  # dark-teal shading
    'R': (255, 159, 28, 255),  # orange (antenna, chest light)
    'E': (11, 11, 22, 255),    # eyes
    'M': (11, 11, 22, 255),    # mouth
    'W': (244, 241, 255, 255), # highlight
}

BASE = [
    ".......RR.......",
    ".......OO.......",
    "....OOOOOOOO....",
    "...OTWTTTTTTO...",
    "..OTWTTTTTTTDO..",
    "..OTEETTTTEEDO..",
    "..OTEETTTTEEDO..",
    "..OTTTTTTTTTDO..",
    "..OTTTMMMMTTDO..",
    "..ODTTTTTTTDDO..",
    "...OODDDDDDOO...",
    ".....OTTTTO.....",
    "...OOTTRRTTOO...",
    "..OTTOTTTTODTO..",
    "..OTTOTDDTODTO..",
    "...OO.OOOO.OO...",
]


def edit(rows, changes):
    rows = [list(r) for r in rows]
    for (y, x), ch in changes.items():
        rows[y][x] = ch
    return [''.join(r) for r in rows]


def eyes(rows, top, bottom):
    """Set both eyes' top and bottom rows (2 px wide each)."""
    ch = {}
    for x in (4, 5, 10, 11):
        ch[(5, x)] = top
        ch[(6, x)] = bottom
    return edit(rows, ch)


blink = eyes(BASE, 'T', 'E')                      # eyes shut: one dark line
look_up = eyes(BASE, 'E', 'T')                    # eyes up: thinking
mouth_open = edit(BASE, {(8, 6): 'M', (8, 9): 'M', (9, 6): 'M', (9, 7): 'M', (9, 8): 'M', (9, 9): 'M'})
no_light = edit(BASE, {(12, 7): 'T', (12, 8): 'T'})

FRAMES = {
    'idle1': BASE,
    'idle2': edit(blink, {(12, 7): 'R', (12, 8): 'R'}),
    'think1': edit(look_up, {(0, 7): 'R', (0, 8): 'R', (3, 14): 'R'}),
    'think2': edit(edit(look_up, {(12, 7): 'T', (12, 8): 'T'}), {(0, 7): '.', (0, 8): '.', (1, 14): 'R'}),
    'talk1': mouth_open,
    'talk2': edit(no_light, {}),
}

OUT_DIRS = [
    os.path.join(os.path.dirname(__file__), '..', 'apps', 'mobile', 'assets', 'bitter'),
    os.path.join(os.path.dirname(__file__), '..', 'apps', 'desktop', 'src', 'ui', 'img'),
]


def render(rows, size):
    img = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(rows):
        assert len(row) == 16, (y, row)
        for x, ch in enumerate(row):
            color = PALETTE[ch]
            if color:
                img.putpixel((x, y), color)
    return img.resize((size, size), Image.NEAREST)


def main():
    for d in OUT_DIRS:
        os.makedirs(d, exist_ok=True)
        for name, rows in FRAMES.items():
            for size in (64, 128):
                path = os.path.join(d, f'bitter-{name}-{size}.png')
                render(rows, size).save(path)
        print('wrote', len(FRAMES) * 2, 'frames to', os.path.relpath(d))


if __name__ == '__main__':
    main()
