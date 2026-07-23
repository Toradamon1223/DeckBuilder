#!/usr/bin/env python3
"""Local dev server for the deck builder web UI."""

from __future__ import annotations

import argparse
import hmac
import html
import json
import os
import re
import secrets
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock
from urllib.parse import parse_qs, urlparse

from card_meta import parse_card_meta_html
from ban_lists import (
    delete_ban_list,
    list_ban_lists,
    load_ban_list,
    save_ban_list,
)
from deck_code import export_deck_code, resolve_deck_import

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT.parent / "data"
CARDS_PATH = ROOT.parent / "output" / "cards.json"
LIMITS_PATH = ROOT.parent / "output" / "card_limits.json"
SET_REG_PATH = DATA_DIR / "set_regulation_map.json"
FORMATS_PATH = DATA_DIR / "regulation_formats.json"
WHITELIST_PATH = DATA_DIR / "standard_trainer_whitelist.json"
BANNED_PATH = DATA_DIR / "banned_cards.json"
ADMIN_SECRET_PATH = DATA_DIR / "admin_secret.txt"
SESSION_COOKIE = "pokeca_admin_session"
SESSION_TTL = timedelta(hours=12)
CARD_MARKS_PATH = ROOT.parent / "output" / "card_regulation_marks.json"
FORMAT_LEGAL_PATH = ROOT.parent / "output" / "card_format_legal.json"
CARD_IMAGES_PATH = ROOT.parent / "output" / "card_images.json"
CARD_META_PATH = ROOT.parent / "output" / "card_meta.json"
EVOLUTION_FAMILIES_PATH = ROOT.parent / "output" / "evolution_families.json"

OFFICIAL_ORIGIN = "https://www.pokemon-card.com"
OFFICIAL_HEADERS = {
    "User-Agent": "Mozilla/5.0",
    "Referer": f"{OFFICIAL_ORIGIN}/deck/deck.html",
}


def normalize_base_path(raw: str | None) -> str:
    value = (raw or "").strip()
    if not value or value == "/":
        return ""
    if not value.startswith("/"):
        value = f"/{value}"
    return value.rstrip("/")


BASE_PATH = normalize_base_path(os.environ.get("POKECA_BASE_PATH", ""))
COOKIE_PATH = BASE_PATH or "/"
COOKIE_SECURE = os.environ.get("POKECA_COOKIE_SECURE", "").lower() in ("1", "true", "yes")

_CARDS_CACHE: list[dict] | None = None
_CARDS_CACHE_LOCK = Lock()
_REGULATION_CONFIG_CACHE: dict | None = None
_BANNED_CACHE: dict | None = None
_CARD_IMAGES_CACHE: dict[str, str] | None = None
_CARD_IMAGES_LOCK = Lock()
_CARD_META_CACHE: dict[str, dict] | None = None
_CARD_META_LOCK = Lock()
_EVOLUTION_FAMILIES_CACHE: list[list[str]] | None = None
_ADMIN_SESSIONS: dict[str, datetime] = {}
_ADMIN_SESSIONS_LOCK = Lock()


def get_admin_password() -> str | None:
    env = os.environ.get("POKECA_ADMIN_PASSWORD", "").strip()
    if env:
        return env
    if ADMIN_SECRET_PATH.is_file():
        try:
            return ADMIN_SECRET_PATH.read_text(encoding="utf-8-sig").strip()
        except OSError:
            return None
    return None


def is_admin_configured() -> bool:
    return bool(get_admin_password())


def verify_admin_password(password: str) -> bool:
    expected = get_admin_password()
    if not expected:
        return False
    return hmac.compare_digest(password, expected)


def create_admin_session() -> str:
    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + SESSION_TTL
    with _ADMIN_SESSIONS_LOCK:
        _ADMIN_SESSIONS[token] = expires
    return token


def validate_admin_session(token: str) -> bool:
    if not token:
        return False
    now = datetime.now(timezone.utc)
    with _ADMIN_SESSIONS_LOCK:
        expires = _ADMIN_SESSIONS.get(token)
        if not expires:
            return False
        if expires <= now:
            del _ADMIN_SESSIONS[token]
            return False
    return True


def revoke_admin_session(token: str) -> None:
    with _ADMIN_SESSIONS_LOCK:
        _ADMIN_SESSIONS.pop(token, None)


def detect_from_name(name: str) -> str:
    if name.startswith("基本") and "エネルギー" in name:
        return "basic_energy"
    if "プリズムスター" in name:
        return "prism_star"
    if name.startswith("かがやく"):
        return "radiant"
    return "normal"


def load_json(path: Path, default: dict | list | None = None):
    if not path.exists():
        return default if default is not None else {}
    return json.loads(path.read_text(encoding="utf-8"))


def load_limits() -> dict[str, str]:
    return load_json(LIMITS_PATH, {})


def load_set_regulation_map() -> dict[str, str]:
    return load_json(SET_REG_PATH, {})


def load_card_regulation_marks() -> dict[str, str]:
    return load_json(CARD_MARKS_PATH, {})


def load_format_legal() -> dict:
    data = load_json(FORMAT_LEGAL_PATH, {"standard": {}, "extra": {}, "complete": False})
    return {
        "standard": data.get("standard") or {},
        "extra": data.get("extra") or {},
        "updated": data.get("updated"),
        "complete": bool(data.get("complete")),
    }


def normalize_card_name(name: str) -> str:
    return html.unescape(name or "")


def load_card_images() -> dict[str, str]:
    global _CARD_IMAGES_CACHE
    if _CARD_IMAGES_CACHE is None:
        _CARD_IMAGES_CACHE = load_json(CARD_IMAGES_PATH, {})
    return _CARD_IMAGES_CACHE


def save_card_images(images: dict[str, str]) -> None:
    global _CARD_IMAGES_CACHE
    CARD_IMAGES_PATH.parent.mkdir(parents=True, exist_ok=True)
    CARD_IMAGES_PATH.write_text(
        json.dumps(images, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    _CARD_IMAGES_CACHE = images


def fetch_card_image_path(card_id: int) -> str:
    url = f"{OFFICIAL_ORIGIN}/deck/deckThumbsImage.php?cardID={card_id}"
    request = urllib.request.Request(url, headers=OFFICIAL_HEADERS)
    with urllib.request.urlopen(request, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if payload.get("result") != 1:
        return ""
    return str(payload.get("thumbsPath") or "").strip()


def get_card_image_path(card_id: int) -> str:
    cid = str(card_id)
    images = load_card_images()
    if cid in images:
        return images[cid]

    with _CARD_IMAGES_LOCK:
        images = load_card_images()
        if cid in images:
            return images[cid]
        try:
            path = fetch_card_image_path(card_id)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            return ""
        if path:
            images[cid] = path
            save_card_images(images)
        return path


def card_image_url(card_id: int) -> str:
    path = get_card_image_path(card_id)
    if not path:
        return ""
    if path.startswith("http"):
        return path
    return f"{OFFICIAL_ORIGIN}{path}"


def load_card_meta() -> dict[str, dict]:
    global _CARD_META_CACHE
    if _CARD_META_CACHE is None:
        _CARD_META_CACHE = load_json(CARD_META_PATH, {})
    return _CARD_META_CACHE


def save_card_meta(meta: dict[str, dict]) -> None:
    global _CARD_META_CACHE, _EVOLUTION_FAMILIES_CACHE
    CARD_META_PATH.parent.mkdir(parents=True, exist_ok=True)
    CARD_META_PATH.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    _CARD_META_CACHE = meta
    families = rebuild_evolution_families(meta)
    save_evolution_families(families)
    _EVOLUTION_FAMILIES_CACHE = families


def load_evolution_families() -> list[list[str]]:
    global _EVOLUTION_FAMILIES_CACHE
    if _EVOLUTION_FAMILIES_CACHE is None:
        data = load_json(EVOLUTION_FAMILIES_PATH, {"families": []})
        _EVOLUTION_FAMILIES_CACHE = data.get("families") or []
    return _EVOLUTION_FAMILIES_CACHE


def save_evolution_families(families: list[list[str]]) -> None:
    global _EVOLUTION_FAMILIES_CACHE
    EVOLUTION_FAMILIES_PATH.parent.mkdir(parents=True, exist_ok=True)
    EVOLUTION_FAMILIES_PATH.write_text(
        json.dumps({"families": families}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    _EVOLUTION_FAMILIES_CACHE = families


def rebuild_evolution_families(meta: dict[str, dict]) -> list[list[str]]:
    parent: dict[str, str] = {}

    def find(name: str) -> str:
        parent.setdefault(name, name)
        if parent[name] != name:
            parent[name] = find(parent[name])
        return parent[name]

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for entry in meta.values():
        names = entry.get("evolution_names") or []
        if not names:
            continue
        base = names[0]
        for name in names:
            union(base, name)

    groups: dict[str, set[str]] = {}
    for entry in meta.values():
        for name in entry.get("evolution_names") or []:
            root = find(name)
            groups.setdefault(root, set()).add(name)

    return [sorted(group) for group in groups.values() if group]


def expand_search_terms(q: str) -> set[str]:
    terms = {q.casefold()}
    for family in load_evolution_families():
        if any(q.casefold() in name.casefold() for name in family):
            terms.update(name.casefold() for name in family)
    return terms


def fetch_card_detail_html(card_id: int) -> str:
    url = f"{OFFICIAL_ORIGIN}/card-search/details.php/card/{card_id}/regu/all"
    request = urllib.request.Request(url, headers=OFFICIAL_HEADERS)
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.read().decode("utf-8", errors="replace")


def get_card_meta(card_id: int, card_name: str = "") -> dict:
    cid = str(card_id)
    meta = load_card_meta()
    if cid in meta:
        return meta[cid]

    with _CARD_META_LOCK:
        meta = load_card_meta()
        if cid in meta:
            return meta[cid]
        try:
            html = fetch_card_detail_html(card_id)
            parsed = parse_card_meta_html(html, card_name)
        except (urllib.error.URLError, TimeoutError):
            parsed = {
                "deck_section": "pokemon",
                "evolution_stage": "other",
                "evolution_names": [card_name] if card_name else [],
            }
        meta[cid] = parsed
        save_card_meta(meta)
        return parsed


def apply_card_meta(enriched: dict) -> dict:
    cid = str(enriched.get("card_id", ""))
    meta = load_card_meta().get(cid)
    if not meta:
        return enriched
    merged = dict(enriched)
    merged["deck_section"] = meta.get("deck_section", merged.get("deck_section"))
    merged["evolution_stage"] = meta.get("evolution_stage", merged.get("evolution_stage"))
    merged["evolution_names"] = meta.get("evolution_names", merged.get("evolution_names"))
    return merged


def load_banned_cards() -> dict:
    global _BANNED_CACHE
    if _BANNED_CACHE is None:
        _BANNED_CACHE = load_json(BANNED_PATH, {"entries": [], "updated": None})
    return _BANNED_CACHE


def save_banned_cards(data: dict) -> None:
    global _BANNED_CACHE
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    data["updated"] = datetime.now(timezone.utc).isoformat()
    BANNED_PATH.write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    _BANNED_CACHE = data


def is_card_banned(card_id: int, fmt: str, bans: dict) -> bool:
    for entry in bans.get("entries", []):
        if int(entry.get("card_id", 0)) != card_id:
            continue
        if fmt in entry.get("formats", []):
            return True
    return False


def resolve_regulation_mark(card: dict, config: dict | None = None) -> str:
    config = config or {}
    cid = str(card.get("card_id", ""))
    marks = config.get("cardRegulationMarks") or {}
    if cid in marks and marks[cid]:
        return str(marks[cid]).strip().upper()
    mark = str(card.get("regulation_mark") or "").strip()
    if mark:
        return mark.upper()
    set_code = str(card.get("set_code") or "").strip()
    smap = config.get("setRegulationMap") or {}
    return str(smap.get(set_code) or "").strip().upper()


def build_name_regulation_marks(config: dict) -> dict[str, list[str]]:
    """card name -> regulation marks present on any printing of that name."""
    by_name: dict[str, set[str]] = {}
    for card in get_enriched_cards():
        name = normalize_card_name(card.get("name", ""))
        if not name:
            continue
        mark = resolve_regulation_mark(card, config)
        if not mark:
            continue
        by_name.setdefault(name, set()).add(mark)
    return {name: sorted(marks) for name, marks in by_name.items()}


def load_regulation_config() -> dict:
    global _REGULATION_CONFIG_CACHE
    if _REGULATION_CONFIG_CACHE is None:
        formats = load_json(FORMATS_PATH, {})
        whitelist = load_json(WHITELIST_PATH, {"names": []})
        base = {
            "formats": formats,
            "trainerWhitelist": whitelist.get("names", []),
            "setRegulationMap": load_set_regulation_map(),
            "bannedCards": load_banned_cards(),
            "cardRegulationMarks": load_card_regulation_marks(),
            "formatLegal": load_format_legal(),
        }
        base["nameRegulationMarks"] = build_name_regulation_marks(base)
        _REGULATION_CONFIG_CACHE = base
    return _REGULATION_CONFIG_CACHE


def invalidate_regulation_cache() -> None:
    global _REGULATION_CONFIG_CACHE, _BANNED_CACHE
    _REGULATION_CONFIG_CACHE = None
    _BANNED_CACHE = None


def get_enriched_cards() -> list[dict]:
    global _CARDS_CACHE
    if _CARDS_CACHE is not None:
        return _CARDS_CACHE
    with _CARDS_CACHE_LOCK:
        if _CARDS_CACHE is None:
            if not CARDS_PATH.exists():
                return []
            cards = json.loads(CARDS_PATH.read_text(encoding="utf-8"))
            limits = load_limits()
            marks = load_card_regulation_marks()
            _CARDS_CACHE = [enrich_card(card, limits, marks) for card in cards]
    return _CARDS_CACHE


def enrich_card(card: dict, limits: dict[str, str], marks: dict[str, str]) -> dict:
    enriched = dict(card)
    cid = str(card["card_id"])
    enriched["name"] = normalize_card_name(card.get("name", ""))
    enriched["limit_type"] = limits.get(cid) or detect_from_name(enriched["name"])
    enriched["limit_group"] = enriched["name"]
    if cid in marks:
        enriched["regulation_mark"] = marks[cid]
    else:
        enriched["regulation_mark"] = card.get("regulation_mark", "")
    image_path = load_card_images().get(cid, "")
    if image_path:
        enriched["image_url"] = card_image_url(int(card["card_id"]))
    return apply_card_meta(enriched)


def has_official_format_legal(config: dict) -> bool:
    legal = config.get("formatLegal") or {}
    return bool(legal.get("complete"))


def is_official_format_legal(card_id: int, fmt: str, config: dict) -> bool | None:
    if not has_official_format_legal(config):
        return None
    bucket = (config.get("formatLegal") or {}).get(fmt) or {}
    return bool(bucket.get(str(card_id)))


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self) -> None:
        if self.path.endswith((".html", ".js", ".css")):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _request_path(self) -> str:
        parsed = urlparse(self.path)
        path = parsed.path or "/"
        if BASE_PATH:
            if path == BASE_PATH:
                return "/"
            if path.startswith(f"{BASE_PATH}/"):
                return path[len(BASE_PATH) :] or "/"
        return path

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = self._request_path()

        if path == "/api/cards":
            self._serve_cards(parse_qs(parsed.query))
            return
        if path == "/api/regulation-config":
            self._serve_regulation_config()
            return
        if path == "/api/banned-cards":
            self._serve_banned_cards()
            return
        if path == "/api/admin/session":
            self._serve_admin_session()
            return
        if path == "/api/card-image":
            self._serve_card_image(parse_qs(parsed.query))
            return
        if path == "/api/card-meta":
            self._serve_card_meta(parse_qs(parsed.query))
            return
        if path == "/api/deck-import":
            self._serve_deck_import(parse_qs(parsed.query))
            return
        if path == "/api/ban-lists":
            self._serve_ban_lists(parse_qs(parsed.query))
            return
        if path.startswith("/data/"):
            self._serve_data_file(path[len("/data/") :])
            return
        if path in ("/", "/index.html"):
            self._serve_html("index.html")
            return
        if path == "/admin.html":
            self._serve_html("admin.html")
            return
        if path == "/battle.html":
            self._serve_html("battle.html")
            return

        # Map prefixed static paths back to files under web/
        if BASE_PATH and parsed.path.startswith(f"{BASE_PATH}/"):
            self.path = path + (("?" + parsed.query) if parsed.query else "")
        elif path == "/" or path.endswith(".html"):
            # Fallback for bare index when BASE_PATH unset (handled above)
            pass
        return super().do_GET()

    def do_POST(self) -> None:
        path = self._request_path()
        if path == "/api/admin/login":
            self._admin_login()
            return
        if path == "/api/admin/logout":
            self._admin_logout()
            return
        if path == "/api/banned-cards":
            self._save_banned_cards()
            return
        if path == "/api/deck-export":
            self._export_deck_code()
            return
        if path == "/api/ban-lists":
            self._save_ban_list()
            return
        if path == "/api/ban-lists/delete":
            self._delete_ban_list()
            return
        self.send_error(404, "Not found")

    def _serve_html(self, filename: str) -> None:
        file_path = ROOT / filename
        if not file_path.is_file():
            self.send_error(404, "Not found")
            return
        text = file_path.read_text(encoding="utf-8")
        text = text.replace("__BASE_PATH__", BASE_PATH)
        body = text.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(body)

    def _get_session_token(self) -> str:
        cookie = self.headers.get("Cookie", "")
        prefix = f"{SESSION_COOKIE}="
        for part in cookie.split(";"):
            part = part.strip()
            if part.startswith(prefix):
                return part[len(prefix) :]
        return ""

    def _cookie_flags(self) -> str:
        flags = f"Path={COOKIE_PATH}; HttpOnly; SameSite=Strict"
        if COOKIE_SECURE:
            flags += "; Secure"
        return flags

    def _set_session_cookie(self, token: str) -> None:
        max_age = int(SESSION_TTL.total_seconds())
        self.send_header(
            "Set-Cookie",
            f"{SESSION_COOKIE}={token}; {self._cookie_flags()}; Max-Age={max_age}",
        )

    def _clear_session_cookie(self) -> None:
        self.send_header(
            "Set-Cookie",
            f"{SESSION_COOKIE}=; {self._cookie_flags()}; Max-Age=0",
        )

    def _write_json(self, status: int, payload: dict, *, set_cookie: str | None = None, clear_cookie: bool = False) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if set_cookie:
            self._set_session_cookie(set_cookie)
        elif clear_cookie:
            self._clear_session_cookie()
        self.end_headers()
        self.wfile.write(body)

    def _require_admin(self) -> bool:
        if not is_admin_configured():
            self._write_json(
                503,
                {
                    "error": "not_configured",
                    "message": "管理者パスワードが未設定です。",
                },
            )
            return False
        if not validate_admin_session(self._get_session_token()):
            self._write_json(
                401,
                {"error": "unauthorized", "message": "管理者ログインが必要です。"},
            )
            return False
        return True

    def _serve_admin_session(self) -> None:
        configured = is_admin_configured()
        authenticated = configured and validate_admin_session(self._get_session_token())
        self._write_json(
            200,
            {"configured": configured, "authenticated": authenticated},
        )

    def _admin_login(self) -> None:
        if not is_admin_configured():
            self._write_json(
                503,
                {
                    "error": "not_configured",
                    "message": "管理者パスワードが未設定です。",
                },
            )
            return

        body = self._read_json_body()
        password = str(body.get("password", "")) if isinstance(body, dict) else ""
        if not verify_admin_password(password):
            self._write_json(
                401,
                {"error": "invalid_password", "message": "パスワードが正しくありません。"},
            )
            return

        token = create_admin_session()
        self._write_json(200, {"authenticated": True}, set_cookie=token)

    def _admin_logout(self) -> None:
        revoke_admin_session(self._get_session_token())
        self._write_json(200, {"authenticated": False}, clear_cookie=True)

    def _read_json_body(self) -> dict | list | None:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return None

    def _serve_banned_cards(self) -> None:
        payload = json.dumps(load_banned_cards(), ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _save_banned_cards(self) -> None:
        if not self._require_admin():
            return

        body = self._read_json_body()
        if not isinstance(body, dict) or "entries" not in body:
            self.send_error(400, "Invalid body: expected { entries: [...] }")
            return

        entries = body["entries"]
        if not isinstance(entries, list):
            self.send_error(400, "Invalid entries")
            return

        cleaned_by_id: dict[int, dict] = {}
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            card_id = int(entry.get("card_id", 0))
            formats = entry.get("formats") or []
            if not card_id or not isinstance(formats, list):
                continue
            valid_formats = sorted(
                {f for f in formats if f in ("standard", "extra")}
            )
            if not valid_formats:
                continue

            existing = cleaned_by_id.get(card_id)
            if existing:
                merged = sorted(set(existing["formats"]) | set(valid_formats))
                existing["formats"] = merged
                if not existing["note"] and entry.get("note"):
                    existing["note"] = str(entry.get("note") or "").strip()
                continue

            cleaned_by_id[card_id] = {
                "card_id": card_id,
                "name": str(entry.get("name") or ""),
                "set_code": str(entry.get("set_code") or ""),
                "number_label": str(entry.get("number_label") or ""),
                "formats": valid_formats,
                "note": str(entry.get("note") or "").strip(),
            }

        cleaned = list(cleaned_by_id.values())
        cleaned.sort(key=lambda e: (e["name"], e["set_code"], e["number_label"]))

        save_banned_cards({"entries": cleaned, "updated": None})
        invalidate_regulation_cache()
        payload = json.dumps(load_banned_cards(), ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_data_file(self, rel_path: str) -> None:
        safe = Path(rel_path)
        if safe.is_absolute() or ".." in safe.parts:
            self.send_error(403, "Forbidden")
            return
        file_path = (DATA_DIR / safe).resolve()
        if not file_path.is_file() or DATA_DIR.resolve() not in file_path.parents:
            self.send_error(404, "Not found")
            return
        payload = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_regulation_config(self) -> None:
        payload = json.dumps(load_regulation_config(), ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_card_image(self, query: dict[str, list[str]]) -> None:
        raw = (query.get("card_id", [""])[0] or "").strip()
        if not raw.isdigit():
            self.send_error(400, "card_id required")
            return
        card_id = int(raw)
        image_url = card_image_url(card_id)
        if not image_url:
            self.send_error(404, "Image not found")
            return
        try:
            request = urllib.request.Request(image_url, headers=OFFICIAL_HEADERS)
            with urllib.request.urlopen(request, timeout=20) as response:
                payload = response.read()
                content_type = response.headers.get("Content-Type") or "image/jpeg"
        except (urllib.error.URLError, TimeoutError):
            self.send_error(502, "Failed to fetch card image")
            return
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "public, max-age=86400")
        self.end_headers()
        self.wfile.write(payload)

    def _export_deck_code(self) -> None:
        body = self._read_json_body()
        if not isinstance(body, dict):
            self._write_json(400, {"error": "invalid_body", "message": "不正なリクエストです。"})
            return

        fmt = str(body.get("format") or "standard").strip()
        if fmt not in ("standard", "extra", "special", "all"):
            fmt = "standard"

        cards = body.get("cards")
        if not isinstance(cards, list):
            self._write_json(400, {"error": "invalid_body", "message": "cards が必要です。"})
            return

        cleaned: list[dict] = []
        for card in cards:
            if not isinstance(card, dict):
                continue
            card_id = int(card.get("card_id", 0))
            qty = int(card.get("qty", 0))
            if card_id <= 0 or qty <= 0:
                continue
            cleaned.append(
                {
                    "card_id": card_id,
                    "qty": qty,
                    "deck_section": str(card.get("deck_section") or "pokemon"),
                }
            )

        try:
            deck_size = int(body.get("deck_size") or body.get("deckSize") or 60)
        except (TypeError, ValueError):
            deck_size = 60

        result = export_deck_code(cleaned, fmt, deck_size)
        status = 200 if "error" not in result else 400
        self._write_json(status, result)

    def _serve_ban_lists(self, query: dict[str, list[str]]) -> None:
        name = (query.get("name", [""])[0] or "").strip()
        if name:
            loaded = load_ban_list(name)
            if not loaded:
                self._write_json(404, {"error": "not_found", "message": "禁止リストが見つかりません。"})
                return
            self._write_json(200, loaded)
            return
        self._write_json(200, {"lists": list_ban_lists()})

    def _save_ban_list(self) -> None:
        if not self._require_admin():
            return
        body = self._read_json_body()
        if not isinstance(body, dict):
            self._write_json(400, {"error": "invalid_body", "message": "不正なリクエストです。"})
            return
        name = str(body.get("name") or "").strip()
        text = str(body.get("text") or "")
        if body.get("entries") and not text:
            text = "\n".join(
                f"{int(e.get('card_id', 0))}\t{e.get('name') or ''}"
                for e in body["entries"]
                if isinstance(e, dict) and int(e.get("card_id", 0)) > 0
            )
        try:
            saved = save_ban_list(name, text)
        except ValueError:
            self._write_json(400, {"error": "invalid_name", "message": "リスト名が不正です。"})
            return
        self._write_json(200, saved)

    def _delete_ban_list(self) -> None:
        if not self._require_admin():
            return
        body = self._read_json_body()
        name = str((body or {}).get("name") or "").strip() if isinstance(body, dict) else ""
        if not delete_ban_list(name):
            self._write_json(404, {"error": "not_found", "message": "禁止リストが見つかりません。"})
            return
        self._write_json(200, {"deleted": name})

    def _serve_deck_import(self, query: dict[str, list[str]]) -> None:
        code = (query.get("code", [""])[0] or "").strip()
        cards = get_enriched_cards()
        cards_by_id = {int(card["card_id"]): card for card in cards}
        result = resolve_deck_import(code, cards_by_id)
        status = 200 if "error" not in result else 400
        payload = json.dumps(result, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(payload)

    def _serve_card_meta(self, query: dict[str, list[str]]) -> None:
        raw = (query.get("card_id", [""])[0] or "").strip()
        if not raw.isdigit():
            self.send_error(400, "card_id required")
            return
        card_id = int(raw)
        name = (query.get("name", [""])[0] or "").strip()
        meta = get_card_meta(card_id, name)
        payload = json.dumps(meta, ensure_ascii=False).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _serve_cards(self, query: dict[str, list[str]]) -> None:
        cards = get_enriched_cards()
        if not cards and not CARDS_PATH.exists():
            self.send_error(404, "cards.json not found. Run scrape_cards.py first.")
            return

        q = (query.get("q", [""])[0] or "").strip().casefold()
        fmt = (query.get("format", ["standard"])[0] or "standard").strip()
        marks_raw = (query.get("marks", [""])[0] or "").strip()
        special_marks = {
            part.strip().upper()
            for part in marks_raw.split(",")
            if part.strip()
        }
        ban_list_name = (query.get("ban_list", [""])[0] or "").strip()
        custom_ban_ids: set[int] = set()
        if ban_list_name:
            loaded = load_ban_list(ban_list_name)
            if loaded:
                custom_ban_ids = {int(e["card_id"]) for e in loaded["entries"]}

        limit_raw = int(query.get("limit", ["50"])[0] or 50)
        limit = limit_raw if limit_raw in (10, 50, 100) else 50
        page = max(int(query.get("page", ["1"])[0] or 1), 1)

        if q:
            direct = [
                card
                for card in cards
                if q in normalize_card_name(card.get("name", "")).casefold()
            ]
            for card in direct[:2]:
                get_card_meta(int(card["card_id"]), card.get("name", ""))

            terms = expand_search_terms(q)
            results = [card for card in cards if self._matches_query(card, q, terms)]
            results.sort(key=lambda card: self._rank_card(card, q))
        else:
            results = []

        config = load_regulation_config()
        if fmt == "special":
            results = [
                card
                for card in results
                if self._is_legal_special(card, special_marks, custom_ban_ids, config)
            ]
        elif fmt != "all":
            results = [
                card
                for card in results
                if self._is_legal(card, fmt, config)
                and int(card.get("card_id", 0)) not in custom_ban_ids
            ]
        elif custom_ban_ids:
            results = [
                card
                for card in results
                if int(card.get("card_id", 0)) not in custom_ban_ids
            ]

        total = len(results)
        max_page = max(1, (total + limit - 1) // limit) if total else 1
        if page > max_page:
            page = max_page
        offset = (page - 1) * limit
        page_results = results[offset : offset + limit]

        payload = json.dumps(
            {
                "total": total,
                "page": page,
                "limit": limit,
                "maxPage": max_page,
                "cards": page_results,
            },
            ensure_ascii=False,
        ).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    @staticmethod
    def _matches_query(card: dict, q: str, terms: set[str] | None = None) -> bool:
        name = normalize_card_name(card.get("name", "")).casefold()
        if terms:
            return any(term in name for term in terms)
        return q in name

    @staticmethod
    def _rank_card(card: dict, q: str) -> tuple:
        name = normalize_card_name(card.get("name", "")).casefold()
        if name == q:
            return (0, 0, len(name), name)
        if name.startswith(q):
            return (1, 0, len(name), name)
        pos = name.find(q)
        return (2, pos, len(name), name)

    @staticmethod
    def _resolve_regulation_mark(card: dict, config: dict) -> str:
        return resolve_regulation_mark(card, config)

    @staticmethod
    def _is_pokemon_card(card: dict, name: str) -> bool:
        category = str(card.get("card_category") or "").strip().lower()
        if category in {"pokemon", "pokémon", "ポケモン"}:
            return True
        if category in {"trainer", "energy", "トレーナーズ", "エネルギー"}:
            return False
        if name.startswith("基本") and "エネルギー" in name:
            return False
        if "プリズムスター" in name or name.startswith("かがやく"):
            return True
        if re.search(r"(?:ex|EX|VMAX|VSTAR|V-UNION|GX)$", name):
            return True
        if re.search(r"(?:エックス|ＥＸ)$", name):
            return True
        if "エネルギー" in name:
            return False
        return False

    @staticmethod
    def _is_legal_special(card: dict, marks: set[str], custom_ban_ids: set[int], config: dict | None = None) -> bool:
        card_id = int(card.get("card_id", 0))
        if card_id in custom_ban_ids:
            return False
        name = normalize_card_name(card.get("name", ""))
        if name.startswith("基本") and "エネルギー" in name:
            return True

        config = config or {}
        mark = resolve_regulation_mark(card, config)
        if mark and mark in marks:
            return True

        # 同名ルール: 選んだマークにその名前の版があれば、トレーナーズ等は全版OK
        if not Handler._is_pokemon_card(card, name):
            name_marks = config.get("nameRegulationMarks") or {}
            for name_mark in name_marks.get(name) or []:
                if name_mark in marks:
                    return True

        whitelist = set(config.get("trainerWhitelist", []))
        if name in whitelist:
            return True

        if not mark:
            official_std = is_official_format_legal(card_id, "standard", config)
            if official_std and marks.intersection({"H", "I", "J"}):
                return True
            official_extra = is_official_format_legal(card_id, "extra", config)
            if official_extra and marks.intersection(set("ABCDEFGHIJ")):
                return True

        return False

    @staticmethod
    def _is_legal(card: dict, fmt: str, config: dict) -> bool:
        card_id = int(card.get("card_id", 0))
        bans = config.get("bannedCards") or {}
        if is_card_banned(card_id, fmt, bans):
            return False

        name = normalize_card_name(card.get("name", ""))
        if name.startswith("基本") and "エネルギー" in name:
            return True

        official = is_official_format_legal(card_id, fmt, config)
        if official is not None:
            if official:
                return True
            whitelist = set(config.get("trainerWhitelist", []))
            if fmt == "standard" and name in whitelist:
                return True
            return False

        formats = config.get("formats", {})
        fmt_cfg = formats.get(fmt, {})
        marks = fmt_cfg.get("marks", [])
        whitelist = set(config.get("trainerWhitelist", []))
        mark = card.get("regulation_mark", "")

        if mark and mark in marks:
            return True
        if fmt == "standard" and name in whitelist:
            return True
        return False

    def log_message(self, format: str, *args) -> None:
        if str(args[1]) != "200":
            super().log_message(format, *args)


def main() -> None:
    parser = argparse.ArgumentParser(description="Deck builder dev server")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--host", default="127.0.0.1")
    args = parser.parse_args()

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    public_base = BASE_PATH or ""
    print(f"Deck builder: http://{args.host}:{args.port}{public_base}/")
    if BASE_PATH:
        print(f"Base path:    {BASE_PATH}")
    print(f"Cards data:   {CARDS_PATH}")
    print("Loading card cache...")
    count = len(get_enriched_cards())
    print(f"Cached {count:,} cards.")
    if is_admin_configured():
        print("Admin:        enabled (禁止カードの変更にはログインが必要)")
    else:
        print("Admin:        disabled — data/admin_secret.txt または POKECA_ADMIN_PASSWORD を設定")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
