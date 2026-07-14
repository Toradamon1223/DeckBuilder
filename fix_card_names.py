"""Fix HTML entities in card names inside cards.json."""

from __future__ import annotations

import html
import json
from pathlib import Path

CARDS_PATH = Path("output/cards.json")
JSONL_PATH = Path("output/cards.jsonl")


def main() -> None:
    cards = json.loads(CARDS_PATH.read_text(encoding="utf-8"))
    changed = 0
    for card in cards:
        raw = card.get("name", "")
        fixed = html.unescape(raw)
        if fixed != raw:
            card["name"] = fixed
            changed += 1

    CARDS_PATH.write_text(
        json.dumps(cards, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"fixed {changed} names in {CARDS_PATH}")

    if JSONL_PATH.exists():
        lines = JSONL_PATH.read_text(encoding="utf-8").splitlines()
        out = []
        jl_changed = 0
        for line in lines:
            if not line.strip():
                continue
            card = json.loads(line)
            raw = card.get("name", "")
            fixed = html.unescape(raw)
            if fixed != raw:
                card["name"] = fixed
                jl_changed += 1
            out.append(json.dumps(card, ensure_ascii=False))
        JSONL_PATH.write_text("\n".join(out) + "\n", encoding="utf-8")
        print(f"fixed {jl_changed} names in {JSONL_PATH}")


if __name__ == "__main__":
    main()
