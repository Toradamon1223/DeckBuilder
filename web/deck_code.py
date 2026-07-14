"""Fetch and parse official Pokemon TCG deck codes."""

from __future__ import annotations

import json
import re
import urllib.error
import urllib.parse
import urllib.request

OFFICIAL_ORIGIN = "https://www.pokemon-card.com"
OFFICIAL_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": f"{OFFICIAL_ORIGIN}/deck/deck.html",
}

DECK_FIELD_IDS = (
    "deck_pke",
    "deck_gds",
    "deck_tool",
    "deck_tech",
    "deck_sup",
    "deck_sta",
    "deck_ene",
)

SECTION_TO_FIELD = {
    "pokemon": "deck_pke",
    "goods": "deck_gds",
    "tool": "deck_tool",
    "support": "deck_sup",
    "stadium": "deck_sta",
    "energy": "deck_ene",
}

FORMAT_TO_REGULATION = {
    "standard": "STD",
    "extra": "H",
    "all": "ALL",
}

DECK_SIZE = 60


def normalize_deck_code(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""

    url_match = re.search(r"deckID/([^/?#'\"\s]+)", text, re.IGNORECASE)
    if url_match:
        return url_match.group(1).strip()

    return re.sub(r"\s+", "", text)


def extract_hidden_field(html: str, field_id: str) -> str:
    for attr in ("id", "name"):
        match = re.search(rf'{attr}="{re.escape(field_id)}"[^>]*value="([^"]*)"', html)
        if match:
            return match.group(1)
    return ""


def parse_deck_field(value: str) -> list[tuple[int, int]]:
    """Parse official deck hidden fields.

    Format per deckMake3.js: ``{cardId}_{quantity}_{1}``
    The middle field is the card count; the third field is a constant (usually 1).
    """
    entries: list[tuple[int, int]] = []
    for segment in (value or "").split("-"):
        if not segment:
            continue
        parts = segment.split("_")
        if len(parts) < 2:
            continue
        try:
            card_id = int(parts[0])
            qty = int(parts[1])
        except ValueError:
            continue
        if card_id > 0 and qty > 0:
            entries.append((card_id, qty))
    return entries


def parse_confirm_html(html: str) -> dict[int, int]:
    merged: dict[int, int] = {}
    for field_id in DECK_FIELD_IDS:
        value = extract_hidden_field(html, field_id)
        if not value:
            continue
        for card_id, qty in parse_deck_field(value):
            merged[card_id] = merged.get(card_id, 0) + qty
    return merged


def fetch_confirm_html(code: str) -> str:
    normalized = normalize_deck_code(code)
    if not normalized:
        raise ValueError("empty_code")

    url = f"{OFFICIAL_ORIGIN}/deck/confirm.html/deckID/{normalized}/"
    request = urllib.request.Request(url, headers=OFFICIAL_HEADERS)
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8", errors="replace")


def resolve_deck_import(code: str, cards_by_id: dict[int, dict]) -> dict:
    normalized = normalize_deck_code(code)
    if not normalized:
        return {"error": "empty_code", "message": "デッキコードを入力してください。"}

    try:
        html = fetch_confirm_html(normalized)
    except urllib.error.HTTPError as exc:
        return {
            "error": "fetch_failed",
            "message": f"公式サイトからデッキを取得できませんでした（HTTP {exc.code}）。",
        }
    except (urllib.error.URLError, TimeoutError):
        return {
            "error": "fetch_failed",
            "message": "公式サイトからデッキを取得できませんでした。",
        }

    quantities = parse_confirm_html(html)
    if not quantities:
        return {
            "error": "not_found",
            "message": "デッキコードが見つからないか、デッキが空です。",
        }

    cards: list[dict] = []
    missing_ids: list[int] = []
    for card_id, qty in sorted(quantities.items()):
        base = cards_by_id.get(card_id)
        if base:
            card = dict(base)
            card["qty"] = qty
            cards.append(card)
            continue
        missing_ids.append(card_id)
        cards.append(
            {
                "card_id": card_id,
                "name": f"不明なカード（ID: {card_id}）",
                "qty": qty,
                "set_code": "",
                "number_label": "",
                "limit_type": "normal",
                "limit_group": f"不明なカード（ID: {card_id}）",
                "regulation_mark": "",
                "deck_section": "pokemon",
            }
        )

    total = sum(quantities.values())
    return {
        "code": normalized,
        "total": total,
        "cards": cards,
        "missing_ids": missing_ids,
    }


def serialize_deck_entry(card_id: int, qty: int) -> str:
    return f"{card_id}_{qty}_1"


def build_deck_fields(cards: list[dict]) -> dict[str, str]:
    buckets: dict[str, list[str]] = {field: [] for field in SECTION_TO_FIELD.values()}
    for card in cards:
        section = str(card.get("deck_section") or "pokemon")
        field = SECTION_TO_FIELD.get(section, "deck_pke")
        card_id = int(card.get("card_id", 0))
        qty = int(card.get("qty", 0))
        if card_id <= 0 or qty <= 0:
            continue
        buckets[field].append(serialize_deck_entry(card_id, qty))
    return {field: "-".join(segments) for field, segments in buckets.items()}


def register_deck_code(fields: dict[str, str], fmt: str = "standard") -> dict:
    regulation = FORMAT_TO_REGULATION.get(fmt, "STD")
    payload = {
        "deckName": "deck",
        "deckCode": "",
        "deckSize": str(DECK_SIZE),
        "regulation_deck_itm": regulation,
        "deck_pke": fields.get("deck_pke", ""),
        "deck_gds": fields.get("deck_gds", ""),
        "deck_tool": fields.get("deck_tool", ""),
        "deck_tech": "",
        "deck_sup": fields.get("deck_sup", ""),
        "deck_sta": fields.get("deck_sta", ""),
        "deck_ene": fields.get("deck_ene", ""),
        "deck_ajs": "",
        "keyword": "",
        "sm_and_keyword": "true",
        "saveDeckID": "",
    }
    body = urllib.parse.urlencode(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{OFFICIAL_ORIGIN}/deck/deckRegistCall.php",
        data=body,
        headers={
            **OFFICIAL_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return {
            "error": "register_failed",
            "message": "公式サイトへのデッキ登録に失敗しました。",
        }

    if result.get("result") != 1 or not result.get("deckID"):
        err = result.get("errMsg") or []
        detail = " / ".join(str(item) for item in err if item)
        return {
            "error": "register_failed",
            "message": detail or "デッキコードの発行に失敗しました。",
        }

    return {"code": str(result["deckID"])}


def export_deck_code(cards: list[dict], fmt: str = "standard") -> dict:
    total = sum(int(card.get("qty", 0)) for card in cards)
    if total != DECK_SIZE:
        return {
            "error": "invalid_size",
            "message": f"デッキは{DECK_SIZE}枚必要です（現在 {total} 枚）。",
        }

    fields = build_deck_fields(cards)
    if not any(fields.values()):
        return {"error": "empty_deck", "message": "デッキが空です。"}

    return register_deck_code(fields, fmt)
