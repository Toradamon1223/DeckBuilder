/** @typedef {'standard'|'extra'|'special'|'all'} RegulationFormat */

import { formatCardName } from "./cardText.js";

export const REGULATION_MARKS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

/**
 * @param {object[]} entries
 */
export function buildBanIndex(entries) {
  /** @type {Record<string, Set<number>>} */
  const byFormat = { standard: new Set(), extra: new Set(), special: new Set() };
  /** @type {Map<string, object>} */
  const details = new Map();

  for (const entry of entries || []) {
    const cardId = Number(entry.card_id);
    if (!cardId) continue;
    for (const format of entry.formats || []) {
      if (!byFormat[format]) byFormat[format] = new Set();
      byFormat[format].add(cardId);
      details.set(`${format}:${cardId}`, entry);
    }
  }

  return { byFormat, details };
}

/**
 * @param {object} card
 * @param {string} format
 * @param {object} config
 */
export function isBanned(card, format, config) {
  const cardId = Number(card.card_id);
  if (!cardId) return false;

  if (config.customBanIds instanceof Set && config.customBanIds.has(cardId)) {
    return true;
  }

  if (format === "all" || format === "special") {
    return false;
  }

  const bans = config.bannedByFormat?.[format];
  return bans ? bans.has(cardId) : false;
}

/**
 * @param {object} card
 * @param {string} format
 * @param {object} config
 */
export function getBanEntry(card, format, config) {
  const cardId = Number(card.card_id);
  if (!cardId) return null;

  if (config.customBanIds instanceof Set && config.customBanIds.has(cardId)) {
    const name = config.customBanNames?.get?.(cardId);
    return {
      card_id: cardId,
      name: name || "",
      note: config.customBanListName
        ? `リスト: ${config.customBanListName}`
        : "禁止リスト",
    };
  }

  if (format === "all" || format === "special") return null;
  return config.banDetails?.get(`${format}:${cardId}`) || null;
}

/**
 * @param {object} card
 * @param {object} config
 */
export function getCardRegulationMark(card, config) {
  const cid = String(card.card_id);
  const marks = config.cardRegulationMarks || {};
  if (Object.prototype.hasOwnProperty.call(marks, cid)) {
    const mark = marks[cid];
    if (mark) return mark;
  }
  if (card.regulation_mark) return card.regulation_mark;
  const setCode = card.set_code || "";
  const map = config.setRegulationMap || {};
  if (setCode && map[setCode]) return map[setCode];
  return "";
}

/**
 * @param {object} config
 */
export function hasOfficialFormatLegal(config) {
  return Boolean(config.formatLegal?.complete);
}

/**
 * @param {object} card
 * @param {string} format
 * @param {object} config
 */
export function isOfficialFormatLegal(card, format, config) {
  if (!hasOfficialFormatLegal(config)) return null;
  const cid = String(card.card_id);
  const bucket = config.formatLegal?.[format];
  if (!bucket) return false;
  return Boolean(bucket[cid]);
}

/**
 * @param {object} card
 * @param {object} config
 */
export function enrichCard(card, config) {
  const mark = getCardRegulationMark(card, config);
  const normalized = { ...card, name: formatCardName(card.name) };
  if (normalized.regulation_mark === mark) return normalized;
  return { ...normalized, regulation_mark: mark };
}

/**
 * @param {object} config
 * @param {string} format
 */
export function getFormatConfig(config, format) {
  const formats = config.formats || {};
  if (formats[format]) return formats[format];
  if (format === "all") {
    return formats.all || { label: "すべて", marks: [] };
  }
  if (format === "special") {
    return (
      formats.special || {
        label: "特殊",
        marks: REGULATION_MARKS,
        note: "レギュマークを個別指定",
      }
    );
  }
  return (
    formats.standard || {
      label: "スタンダード",
      marks: ["H", "I", "J"],
    }
  );
}

/**
 * @param {object} card
 * @param {object} config
 */
export function inferCardKind(card, config) {
  if (card.card_category) return card.card_category;
  const name = formatCardName(card.name || "");
  if (name.startsWith("基本") && name.includes("エネルギー")) {
    return "basic_energy";
  }
  if (config.trainerWhitelist.has(name)) {
    return "trainer";
  }
  if (
    name.includes("プリズムスター") ||
    name.startsWith("かがやく") ||
    /(?:ex|EX|VMAX|VSTAR|V-UNION|GX)$/.test(name) ||
    /(?:エックス|ＥＸ)$/.test(name)
  ) {
    return "pokemon";
  }
  if (name.includes("エネルギー")) {
    return "special_energy";
  }
  return "unknown";
}

/**
 * True if any printing of this card name has one of the allowed marks.
 * @param {string} name
 * @param {Set<string>} allowed
 * @param {object} config
 */
export function nameHasAllowedMark(name, allowed, config) {
  const marks = config.nameRegulationMarks?.[name];
  if (!marks || !marks.length) return false;
  return marks.some((m) => allowed.has(m));
}

/**
 * @param {object} card
 * @param {RegulationFormat} format
 * @param {object} config
 */
export function isLegalInFormat(card, format, config) {
  if (format === "all") {
    return !isBanned(card, format, config);
  }

  const enriched = enrichCard(card, config);
  if (isBanned(enriched, format, config)) return false;

  const kind = inferCardKind(enriched, config);
  const name = formatCardName(enriched.name || "");

  if (kind === "basic_energy") return true;

  if (format === "special") {
    const allowed =
      config.specialMarks instanceof Set
        ? config.specialMarks
        : new Set(getFormatConfig(config, "special").marks || []);
    const mark = enriched.regulation_mark || "";
    if (mark && allowed.has(mark)) return true;

    // 同名ルール: 選んだマークにその名前の版があれば、トレーナーズ等は全版OK
    // （博士の研究のオーキド／アララギ版なども同名として扱う）
    if (kind !== "pokemon" && nameHasAllowedMark(name, allowed, config)) {
      return true;
    }

    // 公式の同名再録トレーナー等（ボスの指令など）
    if (kind !== "pokemon" && config.trainerWhitelist.has(name)) {
      return true;
    }

    // マーク欠損カード向け: 公式スタンダード使用可かつ H/I/J を含む指定なら可
    if (
      !mark &&
      isOfficialFormatLegal(enriched, "standard", config) === true &&
      ["H", "I", "J"].some((m) => allowed.has(m))
    ) {
      return true;
    }

    // マーク欠損カード向け: 公式エクストラ使用可
    if (!mark && isOfficialFormatLegal(enriched, "extra", config) === true) {
      return [...allowed].some((m) => REGULATION_MARKS.includes(m));
    }

    return false;
  }

  const official = isOfficialFormatLegal(enriched, format, config);
  if (official !== null) {
    if (official) return true;
    if (format === "standard" && kind !== "pokemon" && config.trainerWhitelist.has(name)) {
      return true;
    }
    return false;
  }

  const fmt = getFormatConfig(config, format);
  const mark = enriched.regulation_mark || "";

  if ((fmt.marks || []).includes(mark)) return true;

  if (format === "standard" && kind !== "pokemon") {
    if (config.trainerWhitelist.has(name)) {
      return true;
    }
    if (kind === "special_energy" && config.trainerWhitelist.has(name)) {
      return true;
    }
  }

  return false;
}

/**
 * @param {object} card
 * @param {RegulationFormat} format
 * @param {object} config
 */
export function legalityLabel(card, format, config) {
  if (format === "all" && !(config.customBanIds instanceof Set && config.customBanIds.size)) {
    return null;
  }
  const enriched = enrichCard(card, config);
  if (!isBanned(enriched, format, config)) return null;
  const entry = getBanEntry(enriched, format, config);
  return entry?.note ? `禁止: ${entry.note}` : "禁止";
}

/**
 * @param {Map<number, {card: object, qty: number}>} deck
 * @param {RegulationFormat} format
 * @param {object} config
 */
export function collectRegulationWarnings(deck, format, config) {
  if (
    format === "all" &&
    !(config.customBanIds instanceof Set && config.customBanIds.size)
  ) {
    return [];
  }

  const warnings = [];
  for (const { card, qty } of deck.values()) {
    const displayName = formatCardName(card.name);
    if (isBanned(card, format, config)) {
      const entry = getBanEntry(card, format, config);
      const reason = entry?.note ? `（${entry.note}）` : "";
      warnings.push(
        `「${displayName}」×${qty} は${getFormatConfig(config, format).label}で禁止${reason}`
      );
      continue;
    }
    if (format === "all") continue;
    if (!isLegalInFormat(card, format, config)) {
      const fmtLabel = getFormatConfig(config, format).label;
      if (format === "special") {
        warnings.push(
          `「${displayName}」は特殊で使用不可（同名カードに選択中レギュの版なし）`
        );
      } else {
        warnings.push(`「${displayName}」は${fmtLabel}で使用不可`);
      }
    }
  }
  return warnings;
}
