#!/usr/bin/env python3
"""Scrape official Pokemon TCG (JP) card IDs from pokemon-card.com."""

from __future__ import annotations

import argparse
import csv
import html
import json
import random
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from http.cookiejar import CookieJar
from pathlib import Path
from threading import Lock, Thread
from typing import Iterable

BASE_URL = "https://www.pokemon-card.com/card-search/details.php/card/{card_id}/regu/all"
SEARCH_INDEX_URL = "https://www.pokemon-card.com/card-search/index.php"
DEFAULT_MAX_ID = 55_000
DEFAULT_DELAY = 1.0
FORBIDDEN_BACKOFFS = (30, 60, 120, 300)
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

H1_RE = re.compile(r"<h1[^>]*>([^<]+)</h1>", re.IGNORECASE)
OG_TITLE_RE = re.compile(
    r'<meta\s+property="og:title"\s+content="([^"]+)"',
    re.IGNORECASE,
)
SET_CODE_RE = re.compile(
    r'class="img-regulation"[^>]*alt="([^"]+)"',
    re.IGNORECASE,
)
NUMBER_RE = re.compile(
    r"class=\"img-regulation\"[^>]*>\s*&nbsp;(\d+)\s*&nbsp;/&nbsp;(\d+)\s*&nbsp;",
    re.IGNORECASE,
)


@dataclass
class CardRecord:
    card_id: int
    name: str
    set_code: str
    card_number: str
    card_total: str
    number_label: str
    url: str
    scraped_at: str


@dataclass
class ScrapeState:
    next_id: int
    start_id: int
    end_id: int
    started_at: str
    updated_at: str
    stats: dict[str, int]


class RateLimitError(RuntimeError):
    """Raised when the server keeps returning HTTP 403."""


class Spinner:
    FRAMES = "|/-\\"

    def __init__(self, lock: Lock) -> None:
        self.lock = lock
        self.enabled = sys.stdout.isatty()
        self._running = False
        self._message = "starting..."
        self._thread: Thread | None = None

    def start(self) -> None:
        if not self.enabled or self._running:
            return
        self._running = True
        self._thread = Thread(target=self._loop, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if not self._running:
            return
        self._running = False
        if self._thread is not None:
            self._thread.join(timeout=1.0)
        self.clear()

    def update(self, message: str) -> None:
        self._message = message

    def clear(self) -> None:
        if not self.enabled:
            return
        with self.lock:
            sys.stdout.write("\r" + " " * 100 + "\r")
            sys.stdout.flush()

    def emit(self, line: str = "") -> None:
        with self.lock:
            sys.stdout.write("\r" + " " * 100 + "\r")
            if line:
                sys.stdout.write(line + "\n")
            sys.stdout.flush()

    def _loop(self) -> None:
        index = 0
        while self._running:
            frame = self.FRAMES[index % len(self.FRAMES)]
            message = self._message
            with self.lock:
                sys.stdout.write(f"\r{frame} {message}")
                sys.stdout.flush()
            index += 1
            time.sleep(0.12)


class CardScraper:
    def __init__(
        self,
        output_dir: Path,
        delay: float = DEFAULT_DELAY,
        workers: int = 1,
        timeout: float = 20.0,
        retries: int = 3,
        forbidden_retries: int = 5,
        show_spinner: bool = True,
    ) -> None:
        self.output_dir = output_dir
        self.delay = delay
        self.workers = max(1, workers)
        self.timeout = timeout
        self.retries = retries
        self.forbidden_retries = forbidden_retries
        self.write_lock = Lock()
        self.spinner = Spinner(self.write_lock)
        if not show_spinner:
            self.spinner.enabled = False
        self.cookie_jar = CookieJar()
        self.opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(self.cookie_jar),
        )

        self.output_dir.mkdir(parents=True, exist_ok=True)
        self.state_path = self.output_dir / "state.json"
        self.cards_jsonl_path = self.output_dir / "cards.jsonl"
        self.errors_jsonl_path = self.output_dir / "errors.jsonl"
        self._warmup_session()

    @staticmethod
    def _default_headers() -> dict[str, str]:
        return {
            "User-Agent": USER_AGENT,
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,"
                "image/avif,image/webp,*/*;q=0.8"
            ),
            "Accept-Language": "ja-JP,ja;q=0.9,en-US;q=0.8,en;q=0.7",
            "Referer": SEARCH_INDEX_URL,
            "Connection": "keep-alive",
        }

    def _warmup_session(self) -> None:
        try:
            request = urllib.request.Request(
                SEARCH_INDEX_URL,
                headers=self._default_headers(),
            )
            with self.opener.open(request, timeout=self.timeout):
                pass
        except Exception:
            pass

    def fetch_html(self, card_id: int) -> str:
        url = BASE_URL.format(card_id=card_id)
        last_error: Exception | None = None
        forbidden_attempts = 0
        other_attempts = 0
        max_attempts = max(self.retries, self.forbidden_retries)

        for _ in range(max_attempts):
            try:
                request = urllib.request.Request(
                    url,
                    headers=self._default_headers(),
                )
                with self.opener.open(request, timeout=self.timeout) as response:
                    return response.read().decode("utf-8", errors="replace")
            except urllib.error.HTTPError as exc:
                last_error = exc
                if exc.code == 403:
                    forbidden_attempts += 1
                    if forbidden_attempts >= self.forbidden_retries:
                        break
                    wait = FORBIDDEN_BACKOFFS[
                        min(forbidden_attempts - 1, len(FORBIDDEN_BACKOFFS) - 1)
                    ]
                    self._print_rate_limit(card_id, forbidden_attempts, wait)
                    time.sleep(wait)
                    continue
                other_attempts += 1
                if other_attempts < self.retries:
                    time.sleep(min(2.0 * other_attempts, 5.0))
                    continue
                break
            except (urllib.error.URLError, TimeoutError) as exc:
                last_error = exc
                other_attempts += 1
                if other_attempts < self.retries:
                    time.sleep(min(2.0 * other_attempts, 5.0))
                    continue
                break

        if isinstance(last_error, urllib.error.HTTPError) and last_error.code == 403:
            raise RateLimitError(f"card_id={card_id}: HTTP Error 403: Forbidden")
        raise RuntimeError(f"card_id={card_id}: {last_error}")

    @staticmethod
    def parse_card(card_id: int, html: str) -> CardRecord | None:
        h1_match = H1_RE.search(html)
        og_match = OG_TITLE_RE.search(html)
        h1 = h1_match.group(1).strip() if h1_match else ""
        og_title = og_match.group(1).strip() if og_match else ""
        h1 = html.unescape(h1)
        og_title = html.unescape(og_title)

        if h1 == "カード検索" or og_title.startswith("カード検索"):
            return None
        if "カード詳細" not in og_title and not h1:
            return None

        set_match = SET_CODE_RE.search(html)
        number_match = NUMBER_RE.search(html)
        set_code = set_match.group(1).strip() if set_match else ""
        card_number = number_match.group(1) if number_match else ""
        card_total = number_match.group(2) if number_match else ""
        number_label = (
            f"{card_number}/{card_total}" if card_number and card_total else ""
        )

        now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
        return CardRecord(
            card_id=card_id,
            name=h1 or og_title.split("（")[1].split("）")[0]
            if "（" in og_title
            else og_title,
            set_code=set_code,
            card_number=card_number,
            card_total=card_total,
            number_label=number_label,
            url=BASE_URL.format(card_id=card_id),
            scraped_at=now,
        )

    def load_state(self, start_id: int, end_id: int) -> ScrapeState:
        if self.state_path.exists():
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            stats = data.get("stats", {})
            for key in ("valid", "invalid", "errors"):
                stats.setdefault(key, 0)
            return ScrapeState(
                next_id=int(data["next_id"]),
                start_id=int(data.get("start_id", start_id)),
                end_id=int(data.get("end_id", end_id)),
                started_at=data.get("started_at", self._now()),
                updated_at=data.get("updated_at", self._now()),
                stats=stats,
            )

        return ScrapeState(
            next_id=start_id,
            start_id=start_id,
            end_id=end_id,
            started_at=self._now(),
            updated_at=self._now(),
            stats={"valid": 0, "invalid": 0, "errors": 0},
        )

    def save_state(self, state: ScrapeState) -> None:
        state.updated_at = self._now()
        payload = asdict(state)
        with self.write_lock:
            self.state_path.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    def append_jsonl(self, path: Path, payload: dict) -> None:
        line = json.dumps(payload, ensure_ascii=False) + "\n"
        with self.write_lock:
            with path.open("a", encoding="utf-8") as handle:
                handle.write(line)

    def process_id(
        self, card_id: int
    ) -> tuple[str, CardRecord | None, str | None]:
        try:
            html = self.fetch_html(card_id)
            card = self.parse_card(card_id, html)
            if card is None:
                return "invalid", None, None
            return "valid", card, None
        except RateLimitError as exc:
            return "forbidden", None, str(exc)
        except Exception as exc:  # noqa: BLE001 - keep scraping on single-card failure
            return "error", None, str(exc)

    def run(self, start_id: int, end_id: int, resume: bool) -> ScrapeState:
        if resume and self.state_path.exists():
            state = self.load_state(start_id, end_id)
            if state.next_id > end_id:
                print(f"Already completed up to ID {state.end_id}.")
                return state
            print(f"Resuming from card_id={state.next_id}")
        else:
            state = ScrapeState(
                next_id=start_id,
                start_id=start_id,
                end_id=end_id,
                started_at=self._now(),
                updated_at=self._now(),
                stats={"valid": 0, "invalid": 0, "errors": 0},
            )
            self.save_state(state)

        pending_ids = list(range(state.next_id, end_id + 1))
        if not pending_ids:
            return state

        self.spinner.start()
        try:
            if self.workers == 1:
                for card_id in pending_ids:
                    self._update_spinner(state, card_id)
                    status, card, error = self.process_id(card_id)
                    if self._record_result(state, card_id, status, card, error):
                        return state
                    if self.delay > 0:
                        time.sleep(self.delay + random.uniform(0, 0.3))
            else:
                batch_size = self.workers * 4
                for offset in range(0, len(pending_ids), batch_size):
                    batch = pending_ids[offset : offset + batch_size]
                    with ThreadPoolExecutor(max_workers=self.workers) as executor:
                        futures = {
                            executor.submit(self.process_id, card_id): card_id
                            for card_id in batch
                        }
                        for future in as_completed(futures):
                            card_id = futures[future]
                            self._update_spinner(state, card_id)
                            status, card, error = future.result()
                            if self._record_result(state, card_id, status, card, error):
                                return state
                    if self.delay > 0:
                        time.sleep(self.delay + random.uniform(0, 0.3))
        finally:
            self.spinner.stop()

        return state

    def _update_spinner(self, state: ScrapeState, card_id: int) -> None:
        total = state.end_id - state.start_id + 1
        done = card_id - state.start_id + 1
        percent = (done / total) * 100 if total else 100.0
        self.spinner.update(
            f"[{percent:5.1f}%] checking id={card_id}/{state.end_id} "
            f"valid={state.stats['valid']} invalid={state.stats['invalid']} "
            f"errors={state.stats['errors']}"
        )

    def _emit(self, line: str = "") -> None:
        if self.spinner.enabled:
            self.spinner.emit(line)
        elif line:
            print(line, flush=True)

    def _record_result(
        self,
        state: ScrapeState,
        card_id: int,
        status: str,
        card: CardRecord | None,
        error: str | None,
    ) -> bool:
        """Record one result. Returns True when scraping should stop."""
        if status == "forbidden":
            state.next_id = card_id
            self.save_state(state)
            self._print_blocked(card_id, error or "HTTP 403")
            return True

        if status == "valid" and card is not None:
            state.stats["valid"] += 1
            self.append_jsonl(self.cards_jsonl_path, asdict(card))
            self._print_found(card)
        elif status == "invalid":
            state.stats["invalid"] += 1
        else:
            state.stats["errors"] += 1
            self.append_jsonl(
                self.errors_jsonl_path,
                {
                    "card_id": card_id,
                    "error": error or "unknown error",
                    "at": self._now(),
                },
            )

        state.next_id = card_id + 1
        if card_id % 100 == 0 or status == "error":
            self.save_state(state)
            self._print_progress(state, card_id)

        if card_id == state.end_id:
            self.save_state(state)
            self._print_progress(state, card_id)

        return False

    @staticmethod
    def _now() -> str:
        return datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    def _print_found(self, card: CardRecord) -> None:
        if card.set_code and card.number_label:
            detail = f"[{card.set_code} {card.number_label}]"
        elif card.number_label:
            detail = f"[{card.number_label}]"
        else:
            detail = ""
        line = f"+ {card.card_id:5d} {card.name}"
        if detail:
            line += f" {detail}"
        self._emit(line)

    def _print_rate_limit(self, card_id: int, attempt: int, wait: int) -> None:
        line = (
            f"! 403 Forbidden at card_id={card_id} "
            f"(retry {attempt}/{self.forbidden_retries}, wait {wait}s)"
        )
        self._emit(line)

    def _print_blocked(self, card_id: int, message: str) -> None:
        self._emit("")
        self._emit("=" * 60)
        self._emit("アクセス制限を検知しました。ここで停止します。")
        self._emit(f"  card_id={card_id}")
        self._emit(f"  detail: {message}")
        self._emit("")
        self._emit("対処:")
        self._emit("  1. 30〜60分以上待つ")
        self._emit("  2. --delay 1.5 以上で --resume 再開")
        self._emit("  3. 失敗分は --retry-errors で後から再取得")
        self._emit("=" * 60)

    def _print_progress(self, state: ScrapeState, card_id: int) -> None:
        total = state.end_id - state.start_id + 1
        done = card_id - state.start_id + 1
        percent = (done / total) * 100 if total else 100.0
        line = (
            f"[{percent:5.1f}%] id={card_id}/{state.end_id} "
            f"valid={state.stats['valid']} invalid={state.stats['invalid']} "
            f"errors={state.stats['errors']}"
        )
        self._emit(line)


def load_cards_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []

    by_id: dict[int, dict] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            card = json.loads(line)
            by_id[int(card["card_id"])] = card
    return [by_id[card_id] for card_id in sorted(by_id)]


def export_json(cards: Iterable[dict], path: Path) -> None:
    payload = list(cards)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def export_csv(cards: Iterable[dict], path: Path) -> None:
    rows = list(cards)
    fieldnames = [
        "card_id",
        "name",
        "set_code",
        "card_number",
        "card_total",
        "number_label",
        "url",
        "scraped_at",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        for row in rows:
            writer.writerow({key: row.get(key, "") for key in fieldnames})


def load_error_ids(path: Path) -> list[int]:
    if not path.exists():
        return []

    ids: set[int] = set()
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            ids.add(int(json.loads(line)["card_id"]))
    return sorted(ids)


def retry_errors(output_dir: Path, scraper: CardScraper) -> int:
    error_ids = load_error_ids(output_dir / "errors.jsonl")
    if not error_ids:
        print("No error IDs to retry.")
        return 0

    recovered = 0
    still_failed: list[dict] = []
    print(f"Retrying {len(error_ids)} error IDs...")
    scraper.spinner.start()
    try:
        for index, card_id in enumerate(error_ids):
            scraper.spinner.update(f"retry id={card_id} ({index + 1}/{len(error_ids)})")
            status, card, error = scraper.process_id(card_id)
            if status == "forbidden":
                scraper._print_blocked(card_id, error or "HTTP 403")
                still_failed.extend(
                    {
                        "card_id": pending_id,
                        "error": error if pending_id == card_id else "retry interrupted",
                        "at": scraper._now(),
                    }
                    for pending_id in error_ids[index:]
                )
                break
            if status == "valid" and card is not None:
                scraper.append_jsonl(scraper.cards_jsonl_path, asdict(card))
                scraper._print_found(card)
                recovered += 1
            elif status == "invalid":
                scraper._emit(f"- {card_id}: invalid (no card)")
            else:
                still_failed.append(
                    {
                        "card_id": card_id,
                        "error": error or "unknown error",
                        "at": scraper._now(),
                    }
                )
                scraper._emit(f"! {card_id}: {error}")

            if scraper.delay > 0:
                time.sleep(scraper.delay + random.uniform(0, 0.3))
    finally:
        scraper.spinner.stop()

    errors_path = output_dir / "errors.jsonl"
    errors_path.write_text(
        "".join(json.dumps(item, ensure_ascii=False) + "\n" for item in still_failed),
        encoding="utf-8",
    )
    print(f"Recovered {recovered} cards. Remaining errors: {len(still_failed)}")
    return recovered


def dedupe_cards_jsonl(output_dir: Path) -> int:
    jsonl_path = output_dir / "cards.jsonl"
    if not jsonl_path.exists():
        print("No cards.jsonl found.")
        return 0

    before = sum(1 for line in jsonl_path.open(encoding="utf-8") if line.strip())
    cards = load_cards_jsonl(jsonl_path)
    removed = before - len(cards)

    with jsonl_path.open("w", encoding="utf-8") as handle:
        for card in cards:
            handle.write(json.dumps(card, ensure_ascii=False) + "\n")

    print(f"Deduped cards.jsonl: {before} -> {len(cards)} ({removed} removed)")
    return len(cards)


def export_outputs(output_dir: Path) -> int:
    cards = load_cards_jsonl(output_dir / "cards.jsonl")
    export_json(cards, output_dir / "cards.json")
    export_csv(cards, output_dir / "cards.csv")
    print(f"Exported {len(cards)} cards to cards.json and cards.csv")
    return len(cards)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Scrape official Pokemon TCG card IDs from pokemon-card.com",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("output"),
        help="Directory for state and result files (default: output)",
    )
    parser.add_argument(
        "--start",
        type=int,
        default=1,
        help="First card ID to scan (default: 1)",
    )
    parser.add_argument(
        "--end",
        type=int,
        default=DEFAULT_MAX_ID,
        help=f"Last card ID to scan (default: {DEFAULT_MAX_ID})",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY,
        help=f"Delay in seconds between requests (default: {DEFAULT_DELAY})",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=1,
        help="Concurrent workers (default: 1, keep low to reduce server load)",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=20.0,
        help="HTTP timeout in seconds (default: 20)",
    )
    parser.add_argument(
        "--retries",
        type=int,
        default=3,
        help="Retry count for non-403 failures (default: 3)",
    )
    parser.add_argument(
        "--forbidden-retries",
        type=int,
        default=5,
        help="Retry count for HTTP 403 with backoff (default: 5)",
    )
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from output/state.json if it exists",
    )
    parser.add_argument(
        "--export-only",
        action="store_true",
        help="Convert cards.jsonl to cards.json and cards.csv without scraping",
    )
    parser.add_argument(
        "--dedupe",
        action="store_true",
        help="Remove duplicate card_id entries from cards.jsonl and re-export",
    )
    parser.add_argument(
        "--retry-errors",
        action="store_true",
        help="Retry card IDs listed in errors.jsonl",
    )
    parser.add_argument(
        "--no-spinner",
        action="store_true",
        help="Disable live spinner (useful for logs or non-interactive runs)",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    if args.start < 1:
        parser.error("--start must be >= 1")
    if args.end < args.start:
        parser.error("--end must be >= --start")

    output_dir = args.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.dedupe:
        dedupe_cards_jsonl(output_dir)
        export_outputs(output_dir)
        return 0

    if args.export_only:
        count = export_outputs(output_dir)
        return 0 if count >= 0 else 1

    scraper = CardScraper(
        output_dir=output_dir,
        delay=args.delay,
        workers=args.workers,
        timeout=args.timeout,
        retries=args.retries,
        forbidden_retries=args.forbidden_retries,
        show_spinner=not args.no_spinner,
    )

    if args.retry_errors:
        retry_errors(output_dir, scraper)
        export_outputs(output_dir)
        return 0

    print(
        f"Scraping card IDs {args.start}-{args.end} "
        f"into {output_dir.resolve()}",
        flush=True,
    )
    state = scraper.run(args.start, args.end, resume=args.resume)
    export_outputs(output_dir)
    print(
        f"Done. valid={state.stats['valid']} invalid={state.stats['invalid']} "
        f"errors={state.stats['errors']}",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
