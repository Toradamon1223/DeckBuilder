# -*- coding: utf-8 -*-
"""Resolve card IDs from cards.json and register an official deck code."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "web"))

from deck_code import export_deck_code  # noqa: E402

# qty, name, preferred section
DECK_SPEC: list[tuple[int, str, str]] = [
    (2, "モグリュー", "pokemon"),
    (1, "メガドリュウズex", "pokemon"),
    (4, "ダンバル", "pokemon"),
    (4, "メタング", "pokemon"),
    (2, "メタグロス", "pokemon"),
    (1, "メガエアームドex", "pokemon"),
    (2, "ゲノセクトex", "pokemon"),
    (1, "ヒードラン", "pokemon"),
    (1, "シェイミ", "pokemon"),
    (4, "ロケット団のラムダ", "support"),
    (3, "ボスの指令", "support"),
    (3, "ジャッジマン", "support"),
    (1, "ジプソ", "support"),
    (1, "プレシャスキャリー", "goods"),
    (3, "なかよしポフィン", "goods"),
    (3, "ロケット団のレシーバー", "goods"),
    (2, "ハイパーボール", "goods"),
    (1, "ポケモンいれかえ", "goods"),
    (1, "夜のタンカ", "goods"),
    (2, "エネルギーリサイクル", "goods"),
    (1, "グラビティーマウンテン", "stadium"),
    (1, "ブレイブバングル", "tool"),
    (16, "基本鋼エネルギー", "energy"),
]

# Force specific printings (official DeckBuilder card_id)
FORCED_IDS: dict[str, int] = {
    "ヒードラン": 45767,
    "ダンバル": 49212,
    "メタング": 49213,
}


def pick_card(
    name: str,
    cards_by_name: dict[str, list[dict]],
    cards_by_id: dict[int, dict],
    legal: dict,
) -> dict | None:
    forced = FORCED_IDS.get(name)
    if forced is not None:
        card = cards_by_id.get(forced)
        if card is None:
            return None
        return card

    hits = cards_by_name.get(name, [])
    if not hits:
        return None

    def score(c: dict) -> tuple:
        cid = str(c["card_id"])
        is_legal = 1 if legal.get(cid) else 0
        return (is_legal, int(c["card_id"]))

    return max(hits, key=score)


def main() -> int:
    cards = json.loads((ROOT / "output" / "cards.json").read_text(encoding="utf-8"))
    legal_all = json.loads((ROOT / "output" / "card_format_legal.json").read_text(encoding="utf-8"))
    legal = legal_all.get("standard", {})
    limits = json.loads((ROOT / "output" / "card_limits.json").read_text(encoding="utf-8"))
    meta = json.loads((ROOT / "output" / "card_meta.json").read_text(encoding="utf-8"))

    by_name: dict[str, list[dict]] = {}
    by_id: dict[int, dict] = {}
    for c in cards:
        by_name.setdefault(c.get("name") or "", []).append(c)
        by_id[int(c["card_id"])] = c

    if "ロケット団のラムダ" not in by_name and "ラムダ" in by_name:
        by_name["ロケット団のラムダ"] = by_name["ラムダ"]

    report: list[str] = []
    resolved: list[dict] = []
    missing: list[str] = []

    for qty, name, section in DECK_SPEC:
        card = pick_card(name, by_name, by_id, legal)
        if not card:
            missing.append(name)
            report.append(f"MISSING {name} x{qty}")
            continue
        cid = int(card["card_id"])
        if card.get("name") != name and name not in FORCED_IDS:
            report.append(f"NAME MISMATCH expected={name} got={card.get('name')} id={cid}")
        m = meta.get(str(cid), {})
        deck_section = m.get("deck_section") or section
        lim = limits.get(str(cid), "")
        is_legal = bool(legal.get(str(cid)))
        forced = " FORCED" if name in FORCED_IDS else ""
        report.append(
            f"{qty}x {name} -> id={cid} actual={card.get('name')} set={card.get('set_code')} "
            f"num={card.get('number_label')} section={deck_section} "
            f"limit={lim} legal={is_legal}{forced}"
        )
        resolved.append({"card_id": cid, "qty": qty, "deck_section": deck_section, "name": name})

    total = sum(c["qty"] for c in resolved)
    report.append(f"total={total} missing={missing}")
    (ROOT / "_deck_lookup.txt").write_text("\n".join(report), encoding="utf-8")

    if missing or total != 60:
        print("FAILED")
        print("\n".join(report))
        return 1

    result = export_deck_code(resolved, fmt="standard", deck_size=60)
    report.append(f"export={result}")
    (ROOT / "_deck_lookup.txt").write_text("\n".join(report), encoding="utf-8")
    print(json.dumps({"result": result, "forced": FORCED_IDS}, ensure_ascii=False))
    print("\n".join(report[-4:]))
    return 0 if "code" in result else 1


if __name__ == "__main__":
    raise SystemExit(main())
