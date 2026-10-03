#!/usr/bin/env python3
"""Curate the Space's assets from the full auto-battler set — manifest-driven.

The Space ships a SUBSET of auto-battler's 65 MB asset library: only the files the
app actually references. Rather than per-feature copy logic, this resolves a UNION of
asset URLs from one or more manifests and copies exactly those, decoding %-escapes so
URL-encoded folder names (e.g. "Carnival%20NPCs", "_Premade%20Scene") match on disk.

Manifests:
  • web/assets/characters.json   — every sprite sheet the curated characters reference
                                    (built in; body + shadows + extras + companions).
  • extra URL-list files (argv)  — newline-delimited /assets/... URLs, e.g. the map's
                                    MAP_ASSET_URLS dumped from auto-battler. Comment/blank
                                    lines (#, empty) are skipped.

  AB=../auto-battler python3 curate_assets.py [urls1.txt urls2.txt ...]
Run from the tiny-army dir; idempotent. Driven by build.sh so it stays reproducible.
"""
import json
import os
import shutil
import sys
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
AB = os.environ.get("AB", os.path.join(HERE, "..", "auto-battler"))
SRC_ROOT = os.path.join(AB, "public", "assets")
DST_ROOT = os.path.join(HERE, "web", "assets")
MANIFEST = os.path.join(DST_ROOT, "characters.json")


def character_urls(manifest):
    """Every /assets/... sheet URL characters.json points at, across all sheet kinds."""
    urls = set()
    for pack in manifest["packs"]:
        for c in pack["characters"]:
            for k in ("idle", "walk", "attack", "dmg", "die", "attackDiagonal",
                      "attackEffect", "attackProjectile", "attackImpact"):
                if c.get(k):
                    urls.add(c[k])
            for u in (c.get("shadows") or {}).values():
                urls.add(u)
            for e in (c.get("extras") or []):
                for k in ("url", "effect", "projectile", "impact", "shadow"):
                    if e.get(k):
                        urls.add(e[k])
    return urls


def file_urls(path):
    """Newline-delimited /assets/... URLs from an extra manifest (skip blanks/comments)."""
    with open(path) as f:
        return {ln.strip() for ln in f if ln.strip() and not ln.startswith("#")}


def json_asset_urls(path):
    """Every /assets/....png|jpg URL anywhere in a JSON data file (recursive walk). Used for
    effects.json — the classes/enemies skill cards render its effect + status-effect icons."""
    urls = set()

    def walk(o):
        if isinstance(o, str):
            if o.startswith("/assets/") and o.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                urls.add(o)
        elif isinstance(o, dict):
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    if os.path.exists(path):
        walk(json.load(open(path)))
    return urls


def main():
    urls = character_urls(json.load(open(MANIFEST)))
    urls |= json_asset_urls(os.path.join(DST_ROOT, "effects.json"))  # effect + status-effect icons
    for path in sys.argv[1:]:
        urls |= file_urls(path)

    copied = skipped = absent = 0
    for url in sorted(urls):
        # URLs are URL-encoded; decode so the path matches real on-disk folder names (with
        # spaces). The static server decodes requests the same way, so files land where the
        # browser asks. Strip the leading /assets/ (or any leading slash) to get the rel path.
        rel = unquote(url[len("/assets/"):] if url.startswith("/assets/") else url.lstrip("/"))
        src = os.path.join(SRC_ROOT, rel)
        dst = os.path.join(DST_ROOT, rel)
        if os.path.exists(dst):
            skipped += 1
            continue
        if not os.path.exists(src):
            absent += 1  # referenced but missing from the full set too — skip
            continue
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        shutil.copy2(src, dst)
        copied += 1
    print(f"curate: copied={copied} already-present={skipped} missing-from-source={absent}")


if __name__ == "__main__":
    main()
