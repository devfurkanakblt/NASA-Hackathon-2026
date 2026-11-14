"""Download LOLA DEMs (resumable). Usage: python -m preprocess.download [SiteXX ...]"""
import sys
import requests
from . import config as C

UA = {"User-Agent": "LunarSiteNavigator-preprocess/0.1"}


def fetch(url, dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    total = int(requests.head(url, headers=UA, timeout=60).headers.get("Content-Length", 0))
    if dest.exists() and dest.stat().st_size == total:
        print(f"ok   {dest.name} ({total/1e6:.1f} MB)")
        return
    part = dest.with_suffix(dest.suffix + ".part")
    have = part.stat().st_size if part.exists() else 0
    headers = dict(UA, Range=f"bytes={have}-") if have else UA
    with requests.get(url, headers=headers, stream=True, timeout=120) as r:
        r.raise_for_status()
        mode = "ab" if r.status_code == 206 else "wb"
        with open(part, mode) as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    if part.stat().st_size != total:
        raise IOError(f"size mismatch for {dest.name}")
    part.replace(dest)
    print(f"done {dest.name} ({total/1e6:.1f} MB)")


def main(sites):
    for s in sites:
        fetch(C.local_dem_url(s), C.local_dem_path(s))
    fetch(C.REGIONAL_DEM_URL, C.REGIONAL_DEM_PATH)


if __name__ == "__main__":
    main(sys.argv[1:] or list(C.SITES))
