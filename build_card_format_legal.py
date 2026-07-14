"""Build per-card format legality from the official deckCardSearch API."""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

OUT_PATH = Path("output/card_format_legal.json")
STATE_PATH = Path("output/card_format_legal_state.json")
API_URL = "https://www.pokemon-card.com/deck/deckCardSearch.php"
USER_AGENT = {
    "User-Agent": "Mozilla/5.0",
    "Referer": "https://www.pokemon-card.com/deck/deckSearch.php",
}

FORMATS = {
    "standard": "XY",
    "extra": "BW",
}


def fetch_page(regulation: str, page: int, delay: float) -> dict:
    params = urllib.parse.urlencode(
        {
            "keyword": "",
            "regulation_sidebar_form": regulation,
            "page": page,
            "sm_and_keyword": "false",
        }
    )
    url = f"{API_URL}?{params}"
    for attempt in range(5):
        try:
            response = urllib.request.urlopen(
                urllib.request.Request(url, headers=USER_AGENT),
                timeout=30,
            )
            data = json.loads(response.read().decode("utf-8"))
            time.sleep(delay)
            return data
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            wait = min(2.0 * (attempt + 1), 10.0)
            print(f"! page {page} retry {attempt + 1}: {exc}")
            time.sleep(wait)
    raise RuntimeError(f"failed to fetch page {page} for {regulation}")


def load_state() -> dict:
    if STATE_PATH.exists():
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    return {"done": {}, "updated": None}


def save_state(state: dict) -> None:
    state["updated"] = datetime.now(timezone.utc).isoformat()
    STATE_PATH.write_text(json.dumps(state, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_output() -> dict:
    if OUT_PATH.exists():
        return json.loads(OUT_PATH.read_text(encoding="utf-8"))
    return {"standard": {}, "extra": {}, "updated": None}


def save_output(data: dict) -> None:
    data["updated"] = datetime.now(timezone.utc).isoformat()
    data["complete"] = bool(data.get("complete"))
    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Build card_format_legal.json")
    parser.add_argument("--delay", type=float, default=0.35)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()

    state = load_state() if args.resume else {"done": {}, "updated": None}
    output = load_output() if args.resume else {"standard": {}, "extra": {}, "updated": None, "complete": False}

    for fmt, regulation in FORMATS.items():
        if state["done"].get(fmt):
            print(f"skip {fmt} (already done)")
            continue

        print(f"fetching {fmt} ({regulation})...")
        page = 1
        max_page = 1
        while page <= max_page:
            data = fetch_page(regulation, page, args.delay)
            if data.get("result") != 1:
                raise RuntimeError(f"API error on {fmt} page {page}: {data.get('errMsg')}")

            max_page = int(data.get("maxPage") or 1)
            cards = data.get("cardList") or []
            for card in cards:
                cid = str(card.get("cardID", "")).strip()
                if cid:
                    output[fmt][cid] = True

            print(
                f"  {fmt} page {page}/{max_page} "
                f"(+{len(cards)} cards, total {len(output[fmt])})"
            )
            save_output(output)
            page += 1

        state["done"][fmt] = True
        save_state(state)
        print(f"done {fmt}: {len(output[fmt])} cards")

    output["complete"] = all(state["done"].get(fmt) for fmt in FORMATS)
    save_output(output)
    print(f"saved {OUT_PATH} complete={output['complete']}")


if __name__ == "__main__":
    main()
