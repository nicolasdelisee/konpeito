#!/usr/bin/env python3
"""Renders kana to 1-bit bitmaps so the recogniser can be tested outside a browser.

Dev tool only — the app itself renders the glyphs with <canvas> at runtime.
Reads one character per line on stdin, writes {"char": [row-major 0/1], ...} on
stdout.

    echo -n "あ" | python3 tools/render-kana.py 64
"""
import json
import sys

from PIL import Image, ImageDraw, ImageFont

FONT_CANDIDATES = [
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJKjp-Regular.otf",
    "/usr/share/fonts/truetype/fonts-japanese-gothic.ttf",
]


def load_font(size):
    for path in FONT_CANDIDATES:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    raise SystemExit("no Japanese font found")


def render(char, box):
    """Draws the glyph as large as it fits, centred, and returns a 0/1 grid."""
    font = load_font(int(box * 0.78))
    image = Image.new("L", (box, box), 0)
    draw = ImageDraw.Draw(image)
    left, top, right, bottom = draw.textbbox((0, 0), char, font=font)
    width, height = right - left, bottom - top
    if width > box * 0.9 or height > box * 0.9:
        scale = min(box * 0.9 / max(width, 1), box * 0.9 / max(height, 1))
        font = load_font(max(int(box * 0.78 * scale), 8))
        left, top, right, bottom = draw.textbbox((0, 0), char, font=font)
        width, height = right - left, bottom - top
    draw.text(((box - width) / 2 - left, (box - height) / 2 - top), char, font=font, fill=255)
    pixels = image.load()
    return [1 if pixels[x, y] > 96 else 0 for y in range(box) for x in range(box)]


def main():
    box = int(sys.argv[1]) if len(sys.argv) > 1 else 64
    chars = [line for line in sys.stdin.read().split("\n") if line]
    json.dump({char: render(char, box) for char in chars}, sys.stdout)


if __name__ == "__main__":
    main()
