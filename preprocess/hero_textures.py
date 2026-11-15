"""Web-sized derivatives of the LROC Moon photographs for the home-page descent.

The source JPEGs in public/assets stay the reference copies (they are used by the planner
and documented by their .json sidecars). The hero only needs what a screen can show, so
this writes resized WebP copies to public/assets/hero/: a desktop and a mobile set.
Resampling only (Lanczos); no contrast stretch, sharpening or painted detail.

    python -m preprocess.hero_textures
"""

from pathlib import Path

from PIL import Image

Image.MAX_IMAGE_PIXELS = None

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "public" / "assets"
OUT = SRC / "hero"

# (source, output stem, desktop size, mobile size)
JOBS = [
    ("moon-lroc-wac.jpg", "moon-global", (4096, 2048), (2048, 1024)),
    ("moon-south-context.jpg", "moon-south-context", (2048, 2048), (1024, 1024)),
    ("moon-south-polar.jpg", "moon-south-polar", (3072, 3072), (2048, 2048)),
]


def main() -> None:
    OUT.mkdir(exist_ok=True)
    for source, stem, desktop, mobile in JOBS:
        with Image.open(SRC / source) as image:
            gray = image.convert("L")  # LROC WAC is a single grey band stored as RGB
            for suffix, size in (("", desktop), ("-mobile", mobile)):
                target = OUT / f"{stem}{suffix}.webp"
                resized = gray if gray.size == size else gray.resize(size, Image.LANCZOS)
                resized.save(target, "WEBP", quality=82, method=6)
                print(f"{target.relative_to(ROOT)}  {size[0]}x{size[1]}  {target.stat().st_size / 1e6:.2f} MB")
    # Earth on the final skyline: small on screen, colour kept.
    with Image.open(SRC / "earth-blue-marble.jpg") as image:
        target = OUT / "earth.webp"
        image.convert("RGB").resize((1024, 512), Image.LANCZOS).save(target, "WEBP", quality=85, method=6)
        print(f"{target.relative_to(ROOT)}  1024x512  {target.stat().st_size / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
