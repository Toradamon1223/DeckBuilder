"""Named ban lists stored as text files under data/ban_lists/."""

from __future__ import annotations

import re
from pathlib import Path

BAN_LISTS_DIR = Path(__file__).resolve().parent.parent / "data" / "ban_lists"
SAFE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


def ensure_ban_lists_dir() -> Path:
    BAN_LISTS_DIR.mkdir(parents=True, exist_ok=True)
    return BAN_LISTS_DIR


def list_ban_lists() -> list[dict]:
    ensure_ban_lists_dir()
    items: list[dict] = []
    for path in sorted(BAN_LISTS_DIR.glob("*.txt")):
        entries = parse_ban_list_text(path.read_text(encoding="utf-8-sig"))
        items.append(
            {
                "name": path.stem,
                "filename": path.name,
                "count": len(entries),
            }
        )
    return items


def ban_list_path(name: str) -> Path | None:
    if not SAFE_NAME.match(name or ""):
        return None
    path = (ensure_ban_lists_dir() / f"{name}.txt").resolve()
    if ensure_ban_lists_dir().resolve() not in path.parents:
        return None
    return path


def parse_ban_list_text(text: str) -> list[dict]:
    entries: list[dict] = []
    seen: set[int] = set()
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "#" in line:
            line = line.split("#", 1)[0].strip()
        if not line:
            continue
        parts = re.split(r"[\t,|]+", line, maxsplit=1)
        id_part = parts[0].strip()
        if not id_part.isdigit():
            continue
        card_id = int(id_part)
        if card_id <= 0 or card_id in seen:
            continue
        seen.add(card_id)
        name = parts[1].strip() if len(parts) > 1 else ""
        entries.append({"card_id": card_id, "name": name})
    return entries


def serialize_ban_list(entries: list[dict]) -> str:
    lines = [
        "# PCG Deck Builder ban list",
        "# format: card_id<TAB>name",
        "",
    ]
    for entry in entries:
        card_id = int(entry.get("card_id", 0))
        if card_id <= 0:
            continue
        name = str(entry.get("name") or "").strip()
        lines.append(f"{card_id}\t{name}" if name else str(card_id))
    return "\n".join(lines) + "\n"


def load_ban_list(name: str) -> dict | None:
    path = ban_list_path(name)
    if not path or not path.is_file():
        return None
    text = path.read_text(encoding="utf-8-sig")
    entries = parse_ban_list_text(text)
    return {"name": name, "text": text, "entries": entries, "count": len(entries)}


def save_ban_list(name: str, text: str) -> dict:
    path = ban_list_path(name)
    if not path:
        raise ValueError("invalid_name")
    ensure_ban_lists_dir()
    entries = parse_ban_list_text(text)
    normalized = serialize_ban_list(entries)
    path.write_text(normalized, encoding="utf-8")
    return {"name": name, "text": normalized, "entries": entries, "count": len(entries)}


def delete_ban_list(name: str) -> bool:
    path = ban_list_path(name)
    if not path or not path.is_file():
        return False
    path.unlink()
    return True
