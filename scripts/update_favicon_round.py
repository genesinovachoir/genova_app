from __future__ import annotations

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "public" / "icon.png"
OUT = ROOT / "public" / "favicon.ico"


def rounded_image(img: Image.Image, radius_ratio: float = 0.22) -> Image.Image:
    img = img.convert("RGBA")
    w, h = img.size
    radius = int(min(w, h) * radius_ratio)

    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, w, h), radius=radius, fill=255)

    rounded = img.copy()
    rounded.putalpha(mask)
    return rounded


def main() -> None:
    if not SRC.exists():
        raise FileNotFoundError(f"Source icon not found: {SRC}")

    base = Image.open(SRC)
    rounded = rounded_image(base)

    # Include common favicon sizes.
    sizes = [(16, 16), (32, 32), (48, 48)]
    resized_32 = rounded.resize((32, 32), Image.Resampling.LANCZOS)
    resized_32.save(OUT, format="ICO", sizes=sizes)

    print(f"Updated rounded favicon: {OUT}")


if __name__ == "__main__":
    main()
