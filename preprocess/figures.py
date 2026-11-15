"""Static figures for the slides from map.json and season.json -> docs/figures/*.png.

The web app does not show these two files yet, so the slides use these images.
Every value is read from public/data/; nothing is recomputed here.

Usage: python -m preprocess.figures
"""
import json
import math

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

from . import config as C  # noqa: E402

FIG_DIR = C.ROOT / "docs" / "figures"
R_MOON = 1737.4e3


def load(site_id, name):
    return json.loads((C.OUT_DIR / site_id / name).read_text(encoding="utf-8"))


def offset_en(lat0, lon0, lat, lon):
    """East/north offset (m) of a point from the map centre, same projection as map.json."""
    p0, p1, dl = math.radians(lat0), math.radians(lat), math.radians(lon - lon0)
    c = math.sin(p0) * math.sin(p1) + math.cos(p0) * math.cos(p1) * math.cos(dl)
    d = R_MOON * math.acos(max(-1.0, min(1.0, c)))
    az = math.atan2(math.sin(dl) * math.cos(p1), math.cos(p0) * math.sin(p1) - math.sin(p0) * math.cos(p1) * math.cos(dl))
    return d * math.sin(az), d * math.cos(az)


def site04_map():
    doc = load("Site04", "map.json")
    g = doc["grid"]
    n, h = g["nx"], g["halfSizeM"] / 1000
    extent = (-h, h, -h, h)
    s04, s04r = C.SITES["Site04"], C.SITES["Site04R"]
    re, rn = offset_en(s04["lat"], s04["lon"], s04r["lat"], s04r["lon"])

    fig, axes = plt.subplots(1, 3, figsize=(15, 5.2), constrained_layout=True)
    panels = [("sunPct", "Sun in view [%]", "inferno", (0, 100)),
              ("bothPct", "Sun and Earth both in view [%]", "viridis", (0, 100)),
              ("slopeDeg", "Slope [deg] (25 m baseline)", "cividis", (0, 35))]
    for ax, (key, title, cmap, (lo, hi)) in zip(axes, panels):
        z = np.array(doc[key], dtype=float).reshape(n, n)  # row 0 = south -> origin="lower"
        im = ax.imshow(z, origin="lower", extent=extent, cmap=cmap, vmin=lo, vmax=hi)
        fig.colorbar(im, ax=ax, shrink=0.85)
        ax.plot(0, 0, marker="x", ms=11, mew=2.5, color="cyan")
        ax.plot(re / 1000, rn / 1000, marker="o", ms=10, mfc="none", mew=2.5, color="cyan")
        ax.set_title(title, fontsize=12)
        ax.set_xlabel("east [km]")
        ax.set_ylabel("north [km]")
    axes[0].annotate("Site04 catalogue point\n(crater wall)", (0, 0), (-2.8, -2.6), color="white", fontsize=9,
                     arrowprops=dict(arrowstyle="->", color="white"))
    axes[0].annotate("Site04R ridge point\n1.9 km away", (re / 1000, rn / 1000), (-2.8, 2.0), color="white",
                     fontsize=9, arrowprops=dict(arrowstyle="->", color="white"))
    cov = doc["coverage"]
    fig.suptitle(f"Shackleton Rim (Site04), ±3 km around the catalogue point, {g['spacingM']:.0f} m cells - "
                 f"{cov['startUtc'][:10]} to {cov['endUtc'][:10]}, terrain horizon per cell", fontsize=13)
    return fig


def season():
    polar = [s for s in C.SITES if C.SITES[s].get("category") != "contrast" and not C.SITES[s].get("program")]
    fig, axes = plt.subplots(1, 2, figsize=(14, 5.8), layout="constrained", sharey=True)
    for sid in polar:
        doc = load(sid, "season.json")
        months = [m["month"] for m in doc["months"]]
        x = np.arange(len(months))
        style = dict(marker="o", lw=2.2 if sid in ("Site04", "Site04R") else 1.4,
                     ls="--" if sid == "Site04" else "-")
        y = doc["year"]
        axes[0].plot(x, [m["sunPct"] for m in doc["months"]],
                     label=f"{sid}: year Sun {y['sunPct']:.0f} %, Earth {y['earthPct']:.0f} %", **style)
        axes[1].plot(x, [m["earthPct"] for m in doc["months"]], **style)
    for ax, title in zip(axes, ["Sun in view, per month [%]", "Earth in view, per month [%]"]):
        ax.set_xticks(x, [m[2:] for m in months], rotation=45)
        ax.set_ylim(-3, 110)
        ax.axvspan(-0.4, 1.4, color="0.85", zorder=0)
        ax.text(0.5, 106, "app period", ha="center", va="center", fontsize=9, color="0.3")
        ax.set_title(title, fontsize=12)
        ax.grid(alpha=0.3)
    fig.legend(loc="outside lower center", ncol=4, fontsize=9, frameon=False)
    fig.suptitle("South-pole sites over one year (Nov 2026 - Oct 2027), JPL Horizons + terrain horizon, "
                 "10-min samples", fontsize=13)
    return fig


def main():
    FIG_DIR.mkdir(parents=True, exist_ok=True)
    for name, make in [("site04-map.png", site04_map), ("season-polar-sites.png", season)]:
        fig = make()
        fig.savefig(FIG_DIR / name, dpi=150)
        plt.close(fig)
        print(f"wrote {(FIG_DIR / name).relative_to(C.ROOT)}")


if __name__ == "__main__":
    main()
