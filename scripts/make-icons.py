#!/usr/bin/env python3
"""Draw the Bit Browser app icon (a chunky pixel "B") and write every size
the desktop installers and the phone apps need. Run: python3 scripts/make-icons.py"""
import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BG, TEAL, TEAL_DARK, ORANGE = (11, 11, 22), (45, 212, 191), (14, 124, 111), (255, 159, 28)

# 12x12 pixel art: the "B" and an orange cursor block.
GLYPH = [
    "............",
    "..XXXXXXX...",
    "..XXXXXXXX..",
    "..XX....XX..",
    "..XX....XX..",
    "..XXXXXXX...",
    "..XXXXXXXX..",
    "..XX....XX..",
    "..XX....XX..",
    "..XXXXXXXX..",
    "..XXXXXXX.OO",
    "..........OO",
]


def glyph_layer(size, inset, shadow=True):
    """Transparent layer with the pixel P drawn inside `inset` px of padding."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    cell = (size - 2 * inset) / 12
    for y, row in enumerate(GLYPH):
        for x, ch in enumerate(row):
            if ch == ".":
                continue
            x0, y0 = inset + x * cell, inset + y * cell
            box = [round(x0), round(y0), round(x0 + cell), round(y0 + cell)]
            if shadow:
                off = max(1, round(cell * 0.35))
                d.rectangle([box[0] + off, box[1] + off, box[2] + off, box[3] + off], fill=TEAL_DARK if ch == "X" else (160, 94, 0))
            d.rectangle(box, fill=TEAL if ch == "X" else ORANGE)
    return img


def full_icon(size, rounded=False):
    img = Image.new("RGBA", (size, size), BG + (255,))
    border = max(2, size // 32)
    ImageDraw.Draw(img).rectangle([border, border, size - border - 1, size - border - 1], outline=(38, 38, 74), width=border)
    img.alpha_composite(glyph_layer(size, size // 8))
    return img


def save(img, *parts):
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    print("wrote", os.path.relpath(path, ROOT))


# Desktop: electron-builder makes .ico/.icns from a 1024px PNG.
save(full_icon(1024), "apps", "desktop", "build", "icon.png")

# Phone (Expo): app icon, Android adaptive icon layers, splash, favicon.
save(full_icon(1024).convert("RGB"), "apps", "mobile", "assets", "icon.png")
save(Image.new("RGBA", (1024, 1024), BG + (255,)), "apps", "mobile", "assets", "android-icon-background.png")
save(glyph_layer(1024, 300), "apps", "mobile", "assets", "android-icon-foreground.png")  # safe zone is the middle ~66%
mono = glyph_layer(1024, 300, shadow=False)
mono.putdata([(255, 255, 255, a) for (_, _, _, a) in mono.get_flattened_data()])
save(mono, "apps", "mobile", "assets", "android-icon-monochrome.png")
save(glyph_layer(512, 64), "apps", "mobile", "assets", "splash-icon.png")
save(full_icon(48), "apps", "mobile", "assets", "favicon.png")
