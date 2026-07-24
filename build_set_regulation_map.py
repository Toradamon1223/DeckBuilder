"""Build set_code -> regulation_mark mapping for cards.json set codes."""

from __future__ import annotations

import json
import re
from pathlib import Path

CARDS_PATH = Path("output/cards.json")
OUT_PATH = Path("data/set_regulation_map.json")

# Longest prefix first
PREFIX_MARKS = [
    ("M6", "I"),
    ("M5", "I"),
    ("M4", "I"),
    ("M3", "I"),
    ("M2", "I"),
    ("M1", "I"),
    ("MA", "I"),
    ("M-P", "I"),
    ("ME", "I"),
    ("SV10", "I"),
    ("SV11", "I"),
    ("SV9", "H"),
    ("SV8", "H"),
    ("SV7", "H"),
    ("SV6", "H"),
    ("SV5", "H"),
    ("SV4", "G"),
    ("SV3", "G"),
    ("SV2", "G"),
    ("SV1", "G"),
    ("SV", "H"),
    ("S12", "G"),
    ("S11", "G"),
    ("S10", "F"),
    ("S9", "F"),
    ("S8", "E"),
    ("S7", "E"),
    ("S6", "D"),
    ("S5", "D"),
    ("S4", "D"),
    ("S3", "C"),
    ("S2", "C"),
    ("S1", "C"),
    ("SM12", "F"),
    ("SM11", "E"),
    ("SM10", "E"),
    ("SM9", "D"),
    ("SM8", "C"),
    ("SM7", "B"),
    ("SM6", "B"),
    ("SM5", "A"),
    ("SM4", "A"),
    ("SM3", "A"),
    ("SM2", "A"),
    ("SM1", "A"),
    ("SM", "C"),
    ("XY", ""),
    ("BW", ""),
    ("DP", ""),
    ("DPT", ""),
    ("L", ""),
    ("PCG", ""),
    ("ADV", ""),
]

EXPLICIT = {
    "M2a": "I",
    "MA": "I",
    "SVM": "H",
    "SVD": "H",
    "SV-P": "H",
    "S-P": "H",
    "SVG": "",
    "SVHK": "",
    "SVHM": "",
    "SVJL": "",
    "SLL": "",
    "SLD": "",
    "SPZ": "",
    "SPD": "",
    "XYP": "",
    "SMP": "",
    "BWP": "",
    "MC": "",
    "SI": "",
}


def infer_mark(set_code: str) -> str:
    if not set_code:
        return ""
    if set_code in EXPLICIT:
        return EXPLICIT[set_code]
    for prefix, mark in PREFIX_MARKS:
        if set_code.startswith(prefix):
            return mark
    if re.match(r"^[A-Z]+\d", set_code):
        return ""
    return ""


def main() -> None:
    cards = json.loads(CARDS_PATH.read_text(encoding="utf-8"))
    set_codes = sorted({c.get("set_code", "") for c in cards if c.get("set_code")})
    mapping = {code: infer_mark(code) for code in set_codes}
    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(
        json.dumps(mapping, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    from collections import Counter

    counts = Counter(mapping.values())
    print(f"mapped {len(mapping)} set codes")
    print(counts)


if __name__ == "__main__":
    main()
