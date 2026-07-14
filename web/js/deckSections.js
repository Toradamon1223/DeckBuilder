/** @typedef {'pokemon'|'goods'|'tool'|'support'|'stadium'|'energy'} DeckSection */

export const DECK_SECTIONS = [
  { id: "pokemon", label: "ポケモン" },
  { id: "goods", label: "グッズ" },
  { id: "tool", label: "どうぐ" },
  { id: "support", label: "サポート" },
  { id: "stadium", label: "スタジアム" },
  { id: "energy", label: "エネルギー" },
];

export const EVOLUTION_STAGE_ORDER = {
  basic: 0,
  stage1: 1,
  stage2: 2,
  other: 3,
};

/**
 * @param {object} card
 * @returns {DeckSection}
 */
export function getDeckSection(card) {
  const section = card.deck_section;
  if (section && DECK_SECTIONS.some((s) => s.id === section)) {
    return section;
  }
  return inferDeckSection(card);
}

/**
 * @param {object} card
 */
export function inferDeckSection(card) {
  const name = card.name || "";
  if (name.startsWith("基本") && name.includes("エネルギー")) return "energy";
  if (name.includes("エネルギー")) return "energy";
  return "pokemon";
}

/**
 * @param {object} card
 */
export function getEvolutionStage(card) {
  const stage = card.evolution_stage;
  if (stage && stage in EVOLUTION_STAGE_ORDER) return stage;
  return "other";
}

/**
 * @param {object} card
 */
export function getEvolutionLineKey(card) {
  const names = card.evolution_names;
  if (Array.isArray(names) && names.length) {
    return [...names].sort((a, b) => a.localeCompare(b, "ja"))[0];
  }
  return card.name || "";
}

/**
 * @param {object} a
 * @param {object} b
 * @param {Record<string, number[]>} deckOrder
 */
export function compareDeckEntries(a, b, deckOrder) {
  const section = getDeckSection(a.card);
  const order = deckOrder[section] || [];
  const ai = order.indexOf(a.card.card_id);
  const bi = order.indexOf(b.card.card_id);
  const aRank = ai >= 0 ? ai : Number.MAX_SAFE_INTEGER;
  const bRank = bi >= 0 ? bi : Number.MAX_SAFE_INTEGER;
  if (aRank !== bRank) return aRank - bRank;

  if (section === "pokemon") {
    const lineA = getEvolutionLineKey(a.card);
    const lineB = getEvolutionLineKey(b.card);
    if (lineA !== lineB) return lineA.localeCompare(lineB, "ja");

    const stageDiff =
      EVOLUTION_STAGE_ORDER[getEvolutionStage(a.card)] -
      EVOLUTION_STAGE_ORDER[getEvolutionStage(b.card)];
    if (stageDiff !== 0) return stageDiff;
  }

  return a.card.name.localeCompare(b.card.name, "ja");
}

/**
 * @param {Map<number, {card: object, qty: number}>} deck
 * @param {Record<string, number[]>} deckOrder
 */
export function groupDeckBySection(deck, deckOrder) {
  /** @type {Record<string, {card: object, qty: number}[]>} */
  const grouped = Object.fromEntries(DECK_SECTIONS.map((s) => [s.id, []]));

  for (const entry of deck.values()) {
    const section = getDeckSection(entry.card);
    grouped[section].push(entry);
  }

  for (const section of DECK_SECTIONS) {
    grouped[section.id].sort((a, b) => compareDeckEntries(a, b, deckOrder));
  }

  return grouped;
}

/**
 * @param {Record<string, number[]>} deckOrder
 * @param {DeckSection} section
 * @param {number} cardId
 * @param {number} delta
 */
export function moveInSectionOrder(deckOrder, section, cardId, delta) {
  const order = [...(deckOrder[section] || [])];
  const idx = order.indexOf(cardId);
  if (idx < 0) return deckOrder;

  const next = idx + delta;
  if (next < 0 || next >= order.length) return deckOrder;

  [order[idx], order[next]] = [order[next], order[idx]];
  return { ...deckOrder, [section]: order };
}

/**
 * @param {number[]} ids
 * @param {number} newId
 * @param {Map<number, {card: object, qty: number}>} deck
 */
export function insertByDefaultOrder(ids, newId, deck) {
  const combined = [...ids, newId];
  return combined.sort((a, b) =>
    compareDeckEntries(deck.get(a), deck.get(b), createEmptyDeckOrder())
  );
}

/**
 * @param {Record<string, number[]>} deckOrder
 * @param {Map<number, {card: object, qty: number}>} deck
 */
export function syncDeckOrder(deckOrder, deck) {
  const next = { ...deckOrder };
  for (const { id } of DECK_SECTIONS) {
    const ids = [...(next[id] || [])].filter((cid) => deck.has(cid));
    for (const cid of deck.keys()) {
      if (getDeckSection(deck.get(cid).card) === id && !ids.includes(cid)) {
        ids.splice(0, ids.length, ...insertByDefaultOrder(ids, cid, deck));
      }
    }
    next[id] = ids;
  }
  return next;
}

/**
 * @param {Record<string, number[]>} deckOrder
 */
export function createEmptyDeckOrder() {
  return Object.fromEntries(DECK_SECTIONS.map((s) => [s.id, []]));
}
