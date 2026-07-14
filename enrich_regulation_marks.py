"""Fetch per-card regulation marks from official card detail HTML."""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

CARDS_PATH = Path("output/cards.json")
OUT_PATH = Path("output/card_regulation_marks.json")
USER_AGENT = {"User-Agent": "Mozilla/5.0"}
REG_MARK_RE = re.compile(r"ic_regulation_([A-Z0-9]+)\.gif", re.IGNORECASE)


def fetch_html(card_id: int, timeout: float = 20.0) -> str:
    url = (
        f"https://www.pokemon-card.com/card-search/details.php/card/{card_id}/regu/all"
    )
    request = urllib.request.Request(url, headers=USER_AGENT)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def extract_mark(html: str) -> str | None:
    hits = REG_MARK_RE.findall(html)
    if not hits:
        return None
    return hits[0].upper()


def main() -> None:
    parser = argparse.ArgumentParser(description="Build card_regulation_marks.json")
    parser.add_argument("--delay", type=float, default=0.4)
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()

    cards = json.loads(CARDS_PATH.read_text(encoding="utf-8"))
    marks: dict[str, str] = {}
    if args.resume and OUT_PATH.exists():
        marks = json.loads(OUT_PATH.read_text(encoding="utf-8"))

    processed = 0
    found = 0
    for card in cards:
        cid = str(card["card_id"])
        if args.resume and cid in marks:
            continue

        try:
            html = fetch_html(int(cid))
            mark = extract_mark(html)
            if mark is not None:
                marks[cid] = mark
                found += 1
                print(f"mark {cid} {card['name'][:20]} -> {mark}")
            time.sleep(args.delay)
        except (urllib.error.URLError, TimeoutError) as exc:
            print(f"! {cid}: {exc}")
            break

        processed += 1
        if processed % 100 == 0:
            OUT_PATH.write_text(
                json.dumps(marks, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(f"... saved {len(marks)} marks")

        if args.limit and processed >= args.limit:
            break

    payload = marks
    OUT_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"processed {processed}, marks found {found}, saved {len(marks)} entries")


if __name__ == "__main__":
    main()
