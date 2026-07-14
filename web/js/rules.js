export const DECK_SIZE = 60;
export const NAME_LIMIT = 4;

/** @typedef {'basic_energy'|'normal'|'prism_star'|'radiant'|'ace_spec'} LimitType */

/**
 * @param {object} card
 * @returns {LimitType}
 */
export function getLimitType(card) {
  return card.limit_type || detectFromName(card.name);
}

/**
 * @param {string} name
 * @returns {LimitType}
 */
export function detectFromName(name) {
  if (name.startsWith("基本") && name.includes("エネルギー")) return "basic_energy";
  if (name.includes("プリズムスター")) return "prism_star";
  if (name.startsWith("かがやく")) return "radiant";
  return "normal";
}

/** @param {object} card */
export function getLimitGroup(card) {
  return card.name;
}

/**
 * @param {Map<number, {card: object, qty: number}>} deck
 * @param {LimitType} limitType
 */
export function countByLimitType(deck, limitType) {
  let total = 0;
  for (const { card, qty } of deck.values()) {
    if (getLimitType(card) === limitType) total += qty;
  }
  return total;
}

/**
 * @param {Map<number, {card: object, qty: number}>} deck
 * @param {string} name
 */
export function countByName(deck, name) {
  let total = 0;
  for (const { card, qty } of deck.values()) {
    if (card.name === name) total += qty;
  }
  return total;
}

export function totalCards(deck) {
  let total = 0;
  for (const { qty } of deck.values()) total += qty;
  return total;
}

/**
 * @param {Map<number, {card: object, qty: number}>} deck
 * @param {object} card
 * @param {number} delta
 */
export function canChangeQty(deck, card, delta) {
  const limitType = getLimitType(card);
  const name = getLimitGroup(card);
  const currentNameQty = countByName(deck, name);
  const entry = deck.get(card.card_id);
  const currentCardQty = entry ? entry.qty : 0;
  const nextNameQty = currentNameQty + delta;
  const nextCardQty = currentCardQty + delta;

  if (nextCardQty < 0) return { ok: false, reason: "枚数が0未満になります" };

  if (limitType === "basic_energy") {
    return { ok: true };
  }

  if (delta > 0) {
    if (limitType === "prism_star" && countByLimitType(deck, "prism_star") >= 1) {
      return { ok: false, reason: "プリズムスターはデッキに1枚までです" };
    }
    if (limitType === "radiant" && countByLimitType(deck, "radiant") >= 1) {
      return { ok: false, reason: "かがやくポケモンはデッキに1枚までです" };
    }
    if (limitType === "ace_spec" && countByLimitType(deck, "ace_spec") >= 1) {
      return { ok: false, reason: "ACE SPECはデッキに1枚までです" };
    }
    if (nextNameQty > NAME_LIMIT) {
      return {
        ok: false,
        reason: `「${name}」は同名合計${NAME_LIMIT}枚までです`,
      };
    }
  }

  return { ok: true };
}

/**
 * @param {Map<number, {card: object, qty: number}>} deck
 */
export function collectWarnings(deck) {
  const warnings = [];
  const total = totalCards(deck);

  if (total > DECK_SIZE) warnings.push(`枚数が${DECK_SIZE}枚を超えています`);
  if (total < DECK_SIZE && total > 0) warnings.push(`あと${DECK_SIZE - total}枚`);

  const names = new Set([...deck.values()].map(({ card }) => card.name));
  for (const name of names) {
    const qty = countByName(deck, name);
    const sample = [...deck.values()].find(({ card }) => card.name === name)?.card;
    if (!sample) continue;
    const limitType = getLimitType(sample);
    if (limitType === "basic_energy") continue;
    if (qty > NAME_LIMIT) warnings.push(`「${name}」が同名${NAME_LIMIT}枚を超えています`);
  }

  for (const [label, type] of [
    ["プリズムスター", "prism_star"],
    ["かがやく", "radiant"],
    ["ACE SPEC", "ace_spec"],
  ]) {
    const qty = countByLimitType(deck, type);
    if (qty > 1) warnings.push(`${label}はデッキに1枚までです`);
  }

  return warnings;
}

/**
 * @param {object} card
 */
export function limitLabel(card) {
  const type = getLimitType(card);
  if (type === "basic_energy") return "基本エネルギー";
  if (type === "prism_star") return "プリズムスター";
  if (type === "radiant") return "かがやく";
  if (type === "ace_spec") return "ACE SPEC";
  return null;
}
