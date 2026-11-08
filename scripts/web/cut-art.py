"""Cut the founder's generated mascot sheets into web-ready transparent WebP files.

Inputs live in the local, git-excluded `asset/mascot/` folder. Outputs are the
committed, optimized files in `apps/web/public/art/` plus the generated
`apps/web/src/art/manifest.ts` (paths and intrinsic sizes, so the app reserves
space and never shifts layout).

Run from the repo root:  python scripts/web/cut-art.py
Requires Pillow, NumPy and SciPy. Deterministic: same inputs, same outputs.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "asset" / "mascot"
OUT = ROOT / "apps" / "web" / "public" / "art"
MANIFEST = ROOT / "apps" / "web" / "src" / "art" / "manifest.ts"

# (output path, source file, crop box in source pixels or None, max side in px, colour tolerance)
Box = tuple[int, int, int, int] | None
JOBS: list[tuple[str, str, Box, int, int]] = [
    ("blot/hero", "master-v1.png", None, 960, 30),
    # expression sheet, 3x2 framed tiles (crop inside the frames)
    ("blot/idle", "blot-expressions.png", (22, 22, 500, 498), 640, 30),
    ("blot/pending", "blot-expressions.png", (525, 22, 1010, 498), 640, 30),
    ("blot/yes", "blot-expressions.png", (1035, 22, 1515, 498), 640, 30),
    ("blot/no", "blot-expressions.png", (22, 522, 500, 1002), 640, 30),
    ("blot/already", "blot-expressions.png", (525, 522, 1010, 1002), 640, 30),
    ("blot/reveal", "blot-expressions.png", (1035, 522, 1515, 1002), 640, 30),
    # situation scenes, unframed 3x2
    ("scenes/desk", "six-scene-blot.png", (18, 18, 484, 512), 760, 30),
    ("scenes/hanging", "six-scene-blot.png", (498, 12, 1034, 500), 760, 30),
    ("scenes/peek", "six-scene-blot.png", (1018, 80, 1536, 404), 760, 30),
    ("scenes/pool", "six-scene-blot.png", (0, 586, 506, 1016), 760, 30),
    ("scenes/envelope", "six-scene-blot.png", (526, 536, 988, 1016), 760, 30),
    ("scenes/arcade", "six-scene-blot.png", (988, 522, 1536, 1012), 760, 30),
    # die-cut stickers, 4x2 (low tolerance keeps the white sticker border)
    ("stickers/stamping", "sticker-pack.png", (20, 90, 404, 484), 480, 12),
    ("stickers/lift", "sticker-pack.png", (398, 90, 772, 484), 480, 12),
    ("stickers/star", "sticker-pack.png", (766, 90, 1138, 484), 480, 12),
    ("stickers/envelope", "sticker-pack.png", (1138, 90, 1518, 484), 480, 12),
    ("stickers/asleep", "sticker-pack.png", (20, 540, 392, 952), 480, 12),
    ("stickers/coin", "sticker-pack.png", (388, 540, 762, 952), 480, 12),
    ("stickers/pointing", "sticker-pack.png", (758, 540, 1142, 952), 480, 12),
    ("stickers/hiding", "sticker-pack.png", (1138, 540, 1518, 952), 480, 12),
    # Drip, 2x2 framed tiles
    ("drip/crawl", "drip-sidekick.png", (32, 32, 746, 490), 480, 30),
    ("drip/peek", "drip-sidekick.png", (792, 32, 1506, 490), 480, 30),
    ("drip/asleep", "drip-sidekick.png", (32, 534, 746, 993), 480, 30),
    ("drip/startled", "drip-sidekick.png", (792, 534, 1506, 993), 480, 30),
    # the heron clerk
    ("heron/vest", "heron-stamp.png", None, 820, 30),
    ("heron/suit", "heron-stamp.clothes.png", None, 820, 30),
    # token seal (already transparent)
    ("token/seal", "badge-seal.png", None, 512, 30),
    # doodle kit
    ("doodles/star-yellow", "doodle.png", (34, 46, 312, 304), 360, 30),
    ("doodles/star-outline", "doodle.png", (318, 80, 532, 300), 360, 30),
    ("doodles/burst", "doodle.png", (538, 66, 772, 306), 360, 30),
    ("doodles/sparkle", "doodle.png", (780, 52, 996, 306), 360, 30),
    ("doodles/star-pink", "doodle.png", (998, 82, 1222, 300), 360, 30),
    ("doodles/shooting-star", "doodle.png", (1222, 70, 1512, 300), 360, 30),
    ("doodles/arrow-curve", "doodle.png", (56, 322, 406, 512), 360, 30),
    ("doodles/arrow-loop", "doodle.png", (410, 322, 776, 512), 360, 30),
    ("doodles/arrow-zigzag", "doodle.png", (782, 346, 1136, 504), 360, 30),
    ("doodles/arrow-double", "doodle.png", (1148, 344, 1492, 500), 360, 30),
    ("doodles/underline-red", "doodle.png", (20, 524, 396, 712), 360, 30),
    ("doodles/underline-grape", "doodle.png", (406, 560, 774, 702), 360, 30),
    ("doodles/squiggle", "doodle.png", (776, 566, 1148, 690), 360, 30),
    ("doodles/bubble", "doodle.png", (1152, 490, 1516, 736), 420, 30),
    ("doodles/ribbon", "doodle.png", (16, 790, 300, 940), 360, 30),
    ("doodles/coin", "doodle.png", (300, 770, 490, 960), 300, 30),
    ("doodles/envelope", "doodle.png", (488, 776, 740, 960), 300, 30),
    ("doodles/jar", "doodle.png", (742, 740, 962, 990), 300, 30),
    ("doodles/key", "doodle.png", (964, 740, 1112, 990), 300, 30),
    ("doodles/magnifier", "doodle.png", (1114, 740, 1300, 990), 300, 30),
    ("doodles/hand", "doodle.png", (1300, 720, 1516, 990), 300, 30),
]

FAVICON_SIZES = (32, 64, 180, 192, 512)


def border_median(a: np.ndarray) -> np.ndarray:
    edges = np.concatenate([a[:3].reshape(-1, 3), a[-3:].reshape(-1, 3), a[:, :3].reshape(-1, 3), a[:, -3:].reshape(-1, 3)])
    return np.median(edges, axis=0)


def cut_background(rgb: np.ndarray, tol: int) -> np.ndarray:
    """Return RGBA: cream paper and the grey floor shadow connected to the border become transparent."""
    a = rgb.astype(np.float64)
    bg = border_median(a)
    dist = np.sqrt(((a - bg) ** 2).sum(-1))
    hi, lo = a.max(-1), a.min(-1)
    shadow = (hi - lo < 30) & (hi > 110) & (hi < 220)
    candidate = (dist < tol) | shadow
    labels, _ = ndi.label(candidate)
    edge_labels = np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))
    background = np.isin(labels, edge_labels[edge_labels != 0])

    alpha = np.where(background, 0.0, 1.0)
    # Feather the 2 px band next to the background and remove the cream fringe from its colour.
    band = ndi.binary_dilation(background, iterations=2) & ~background
    soft = np.clip((dist - 6) / 60.0, 0.0, 1.0)
    alpha[band] = soft[band]
    safe = np.maximum(alpha, 1e-3)[..., None]
    colour = np.clip((a - (1 - alpha[..., None]) * bg) / safe, 0, 255)
    colour[alpha == 0] = 0
    return np.dstack([colour, alpha * 255]).astype(np.uint8)


def drop_edge_fragments(rgba: np.ndarray, share: float = 0.02) -> np.ndarray:
    """Remove small foreground pieces that touch the crop edge: slivers of a neighbouring drawing."""
    labels, count = ndi.label(rgba[..., 3] > 8)
    if count < 2:
        return rgba
    sizes = ndi.sum_labels(np.ones(labels.shape), labels, index=np.arange(1, count + 1))
    edge = set(np.unique(np.concatenate([labels[0], labels[-1], labels[:, 0], labels[:, -1]]))) - {0}
    out = rgba.copy()
    for label in edge:
        if sizes[label - 1] < share * sizes.sum():
            out[labels == label] = 0
    return out


def trim(rgba: np.ndarray, pad: int = 6) -> np.ndarray:
    ys, xs = np.nonzero(rgba[..., 3] > 8)
    y0, y1 = max(ys.min() - pad, 0), min(ys.max() + pad + 1, rgba.shape[0])
    x0, x1 = max(xs.min() - pad, 0), min(xs.max() + pad + 1, rgba.shape[1])
    return rgba[y0:y1, x0:x1]


def fit(img: Image.Image, max_side: int) -> Image.Image:
    scale = min(1.0, max_side / max(img.size))
    if scale == 1.0:
        return img
    return img.resize((round(img.width * scale), round(img.height * scale)), Image.LANCZOS)


def main() -> None:
    entries: dict[str, dict[str, object]] = {}
    for name, source, box, max_side, tol in JOBS:
        img = Image.open(SRC / source)
        if box:
            img = img.crop(box)
        if img.mode == "RGBA" and np.asarray(img)[..., 3].min() == 0:
            rgba = np.asarray(img)
        else:
            rgba = cut_background(np.asarray(img.convert("RGB")), tol)
        out = fit(Image.fromarray(trim(drop_edge_fragments(rgba))), max_side)
        path = OUT / f"{name}.webp"
        path.parent.mkdir(parents=True, exist_ok=True)
        out.save(path, "WEBP", quality=90, method=6)
        entries[name] = {"src": f"/art/{name}.webp", "w": out.width, "h": out.height}
        if name == "token/seal":
            for size in FAVICON_SIZES:
                out.resize((size, size), Image.LANCZOS).save(OUT.parent / f"icon-{size}.png", optimize=True)

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(entries, indent=2)
    MANIFEST.write_text(
        "// Generated by scripts/web/cut-art.py. Do not edit by hand.\n"
        f"export const art = {body} as const;\n\n"
        "export type ArtName = keyof typeof art;\n",
        encoding="utf-8",
    )
    print(f"wrote {len(entries)} images to {OUT}")


if __name__ == "__main__":
    main()
