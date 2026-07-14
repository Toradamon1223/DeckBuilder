"""Parse card metadata (section, evolution) from official detail HTML."""

from __future__ import annotations

import html
import re
import urllib.parse

TYPE_RE = re.compile(r'class="type"[^>]*>\s*([^<]+)', re.IGNORECASE)
H1_RE = re.compile(r"<h1[^>]*>([^<]+)", re.IGNORECASE)
H2_RE = re.compile(r"<h2[^>]*>([^<]+)</h2>", re.IGNORECASE)
EVO_NAME_RE = re.compile(r"pokemon=([^&\"']+)")


def normalize_type_text(text: str) -> str:
    decoded = html.unescape(text or "")
    return re.sub(r"\s+", "", decoded)


def parse_evolution_names(html: str) -> list[str]:
    names: set[str] = set()
    for match in EVO_NAME_RE.finditer(html):
        name = urllib.parse.unquote(match.group(1)).strip()
        if name:
            names.add(name)
    return sorted(names)


def infer_deck_section(h2s: list[str], type_text: str, card_name: str) -> str:
    joined = " ".join(h2s)
    if "ポケモンのどうぐ" in joined:
        return "tool"
    if "グッズ" in joined:
        return "goods"
    if "サポート" in joined:
        return "support"
    if "スタジアム" in joined:
        return "stadium"
    if "基本エネルギー" in joined or (
        "エネルギー" in joined and "ポケモン" not in joined
    ):
        return "energy"
    if card_name.startswith("基本") and "エネルギー" in card_name:
        return "energy"
    if "エネルギー" in card_name and not type_text:
        return "energy"
    if type_text:
        return "pokemon"
    return "pokemon"


def infer_evolution_stage(type_text: str) -> str:
    if not type_text:
        return "other"
    if "たね" in type_text:
        return "basic"
    if "1進化" in type_text:
        return "stage1"
    if "2進化" in type_text:
        return "stage2"
    return "other"


def parse_card_meta_html(html: str, card_name: str = "") -> dict:
    h1 = H1_RE.search(html)
    name = (h1.group(1).strip() if h1 else card_name) or card_name
    h2s = [m.group(1).strip() for m in H2_RE.finditer(html)]
    type_match = TYPE_RE.search(html)
    type_text = normalize_type_text(type_match.group(1)) if type_match else ""
    evolution_names = parse_evolution_names(html)
    if name and name not in evolution_names:
        evolution_names = sorted(set(evolution_names) | {name})

    return {
        "deck_section": infer_deck_section(h2s, type_text, name),
        "evolution_stage": infer_evolution_stage(type_text),
        "evolution_names": evolution_names,
    }
