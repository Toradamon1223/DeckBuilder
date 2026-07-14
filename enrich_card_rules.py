"""Detect deck limit types and build card_limits.json (ACE SPEC needs HTML)."""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.request
from pathlib import Path

CARDS_PATH = Path("output/cards.json")
LIMITS_PATH = Path("output/card_limits.json")
USER_AGENT = {"User-Agent": "Mozilla/5.0"}


def detect_from_name(name: str) -> str:
    if name.startswith("基本") and "エネルギー" in name:
        return "basic_energy"
    if "プリズムスター" in name:
        return "prism_star"
    if name.startswith("かがやく"):
        return "radiant"
    return "normal"


def detect_from_html(html: str) -> str | None:
    if "ACE SPEC" in html:
        return "ace_spec"
    return None


def fetch_html(card_id: int, timeout: float = 20.0) -> str:
    url = f"https://www.pokemon-card.com/card-search/details.php/card/{card_id}/regu/all"
    request = urllib.request.Request(url, headers=USER_AGENT)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build card_limits.json")
    parser.add_argument("--delay", type=float, default=0.5)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--only-ace-spec", action="store_true")
    args = parser.parse_args()

    cards = json.loads(CARDS_PATH.read_text(encoding="utf-8"))
    limits: dict[str, str] = {}
    if args.resume and LIMITS_PATH.exists():
        limits = json.loads(LIMITS_PATH.read_text(encoding="utf-8"))

    for card in cards:
        cid = str(card["card_id"])
        name = card["name"]
        limit_type = limits.get(cid) or detect_from_name(name)

        if args.only_ace_spec:
            if limit_type != "normal":
                continue
            try:
                html = fetch_html(int(cid))
                found = detect_from_html(html)
                if found:
                    limit_type = found
                    limits[cid] = limit_type
                    print(f"ace_spec: {cid} {name}")
                time.sleep(args.delay)
            except (urllib.error.URLError, TimeoutError) as exc:
                print(f"! {cid}: {exc}")
            continue

        if cid in limits:
            continue
        limits[cid] = limit_type
        if int(cid) % 500 == 0:
            LIMITS_PATH.write_text(
                json.dumps(limits, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            print(f"saved through card_id={cid}")

    LIMITS_PATH.write_text(
        json.dumps(limits, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    counts: dict[str, int] = {}
    for value in limits.values():
        counts[value] = counts.get(value, 0) + 1
    print("done:", counts)


if __name__ == "__main__":
    main()
