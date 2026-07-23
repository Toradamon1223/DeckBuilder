import { appUrl } from "./paths.js";
import { cardImageSrc } from "./cardImage.js";

const BUILDER_DECK_KEY = "pokeca-deck-builder-v2";
const PRESET_CODE = "8JYGcx-SH8aqk-4GxD8K";

/** Known basics / evolution for this practice table (fallback if meta missing). */
const BASIC_NAMES = new Set([
  "モグリュー",
  "ダンバル",
  "メガエアームドex",
  "ゲノセクトex",
  "ヒードラン",
  "シェイミ",
]);

const EVOLVES_FROM = {
  メガドリュウズex: ["モグリュー"],
  メタング: ["ダンバル"],
  メタグロス: ["メタング"],
};

const MAX_BENCH = 5;
const BENCH_SLOTS = 8;
const ZERO_CAVE = "ゼロの大空洞";

const SUPPORT_NAMES = new Set([
  "ロケット団のラムダ",
  "ボスの指令",
  "ジャッジマン",
  "ジプソ",
]);

const GOODS_NAMES = new Set([
  "プレシャスキャリー",
  "なかよしポフィン",
  "ロケット団のレシーバー",
  "ハイパーボール",
  "ポケモンいれかえ",
  "夜のタンカ",
  "エネルギーリサイクル",
]);

const HP_HINT = {
  モグリュー: 70,
  ダンバル: 70,
  メタング: 100,
  メタグロス: 180,
  メガドリュウズex: 340,
  メガエアームドex: 280,
  ゲノセクトex: 220,
  ヒードラン: 140,
  シェイミ: 70,
};

function cardHp(card) {
  return Number(card.hp) || HP_HINT[card.name] || 0;
}

function isPokemonCard(card) {
  if (card.deck_section === "pokemon") return true;
  if (BASIC_NAMES.has(card.name) || EVOLVES_FROM[card.name]) return true;
  if (isEnergy(card)) return false;
  if (card.deck_section && card.deck_section !== "pokemon") return false;
  return false;
}

function isBasicCard(card) {
  if (BASIC_NAMES.has(card.name)) return true;
  return card.evolution_stage === "basic";
}

function isTrainerCard(card) {
  if (["goods", "support", "stadium", "tool"].includes(card.deck_section)) return true;
  if (SUPPORT_NAMES.has(card.name) || GOODS_NAMES.has(card.name)) return true;
  if (card.limit_type === "ace_spec") return true;
  const n = card.name || "";
  return n.includes("マウンテン") || n.includes("スタジアム") || n.includes("指令");
}

function getMaxBench() {
  const cave = state?.stadium?.name === ZERO_CAVE;
  const field = [state?.active, ...(state?.bench || [])].filter(Boolean);
  const hasTera = field.some((p) => p.terastal);
  return cave && hasTera ? BENCH_SLOTS : MAX_BENCH;
}

function remainingBenchSlots() {
  return Math.max(0, getMaxBench() - (state?.bench?.length || 0));
}

/**
 * destination: hand | bench
 * source: deck | hand
 * mode: single click confirm | multi select + confirm
 */
const TRAINER_EFFECTS = {
  ロケット団のレシーバー: {
    title: "ロケット団のレシーバー",
    hint: "名前に「ロケット団」とつくサポートを1枚選び、相手に見せて手札へ → 山札を切る",
    source: "deck",
    destination: "hand",
    min: 0,
    max: 1,
    multi: false,
    shuffleAfter: true,
    reveal: true,
    filter: (card) =>
      (card.deck_section === "support" || SUPPORT_NAMES.has(card.name)) &&
      (card.name || "").includes("ロケット団"),
  },
  ハイパーボール: {
    title: "ハイパーボール",
    hint: "手札を2枚トラッシュしてから、山札のポケモン1枚を手札へ → 山札を切る",
    discardFromHand: 2,
    source: "deck",
    destination: "hand",
    min: 0,
    max: 1,
    multi: false,
    shuffleAfter: true,
    filter: (card) => isPokemonCard(card),
  },
  ロケット団のラムダ: {
    title: "ロケット団のラムダ",
    hint: "山札からトレーナーズを1枚選んで手札へ → 山札を切る",
    source: "deck",
    destination: "hand",
    min: 0,
    max: 1,
    multi: false,
    shuffleAfter: true,
    filter: (card) => isTrainerCard(card),
  },
  なかよしポフィン: {
    title: "なかよしポフィン",
    hint: "HP70以下のたねを最大2枚、山札からベンチへ → 山札を切る",
    source: "deck",
    destination: "bench",
    min: 0,
    max: 2,
    multi: true,
    shuffleAfter: true,
    filter: (card) => isBasicCard(card) && cardHp(card) > 0 && cardHp(card) <= 70,
    maxDynamic: () => Math.min(2, remainingBenchSlots()),
  },
  プレシャスキャリー: {
    title: "プレシャスキャリー",
    hint: "山札のたねを好きなだけベンチへ（通常ベンチ5 / ゼロの大空洞+場のテラスタルで8）→ 山札を切る",
    source: "deck",
    destination: "bench",
    min: 0,
    max: 8,
    multi: true,
    shuffleAfter: true,
    filter: (card) => isBasicCard(card),
    maxDynamic: () => remainingBenchSlots(),
  },
};

let uidSeq = 1;
let catalog = []; // expanded card templates from loaded deck
let state = null;
let actionArmTimer = null;
/** @type {null | object} */
let effectSession = null;

const els = {
  code: document.getElementById("battle-deck-code"),
  load: document.getElementById("battle-load-deck"),
  loadBuilder: document.getElementById("battle-load-builder"),
  newGame: document.getElementById("battle-new-game"),
  status: document.getElementById("battle-status"),
  main: document.getElementById("battle-main"),
  turnLabel: document.getElementById("battle-turn-label"),
  draw: document.getElementById("battle-draw"),
  endTurn: document.getElementById("battle-end-turn"),
  actions: document.getElementById("battle-actions"),
  log: document.getElementById("battle-log"),
  active: document.getElementById("zone-active"),
  stadium: document.getElementById("zone-stadium"),
  deckPile: document.getElementById("zone-deck"),
  bench: document.getElementById("zone-bench"),
  hand: document.getElementById("zone-hand"),
  handActions: document.getElementById("battle-hand-actions"),
  prizes: document.getElementById("zone-prizes"),
  discard: document.getElementById("zone-discard"),
  countDeck: document.getElementById("count-deck"),
  countPrize: document.getElementById("count-prize"),
  countDiscard: document.getElementById("count-discard"),
  countMulligan: document.getElementById("count-mulligan"),
  countHand: document.getElementById("count-hand"),
  searchModal: document.getElementById("deck-search-modal"),
  searchTitle: document.getElementById("deck-search-title"),
  searchHint: document.getElementById("deck-search-hint"),
  searchList: document.getElementById("deck-search-list"),
  searchCount: document.getElementById("deck-search-count"),
  searchSkip: document.getElementById("deck-search-skip"),
  searchConfirm: document.getElementById("deck-search-confirm"),
};

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function cloneCard(template) {
  return {
    uid: uidSeq++,
    card_id: template.card_id,
    name: template.name,
    image_url: template.image_url || "",
    deck_section: template.deck_section || "pokemon",
    evolution_stage: template.evolution_stage || "",
    limit_type: template.limit_type || "",
    damage: 0,
    energies: [],
    hp: HP_HINT[template.name] || 0,
    terastal: false,
  };
}

function isEnergy(card) {
  return (
    card.deck_section === "energy" ||
    (card.name || "").includes("エネルギー")
  );
}

function isBasic(card) {
  // Prefer known basics — meta stage can be missing/wrong for new cards
  if (BASIC_NAMES.has(card.name)) return true;
  return card.evolution_stage === "basic";
}

function isPokemon(card) {
  return card.deck_section === "pokemon" || BASIC_NAMES.has(card.name) || EVOLVES_FROM[card.name];
}

function canEvolveOnto(evoCard, target) {
  const from = EVOLVES_FROM[evoCard.name];
  if (!from) return false;
  return from.includes(target.name);
}

function log(msg) {
  if (!state) return;
  state.log.unshift(msg);
  if (state.log.length > 80) state.log.length = 80;
}

function setStatus(msg) {
  els.status.textContent = msg;
}

function expandDeckList(cards) {
  const out = [];
  for (const c of cards) {
    const qty = Number(c.qty) || 0;
    for (let i = 0; i < qty; i++) {
      out.push({
        card_id: Number(c.card_id),
        name: c.name || `ID:${c.card_id}`,
        image_url: c.image_url || "",
        deck_section: c.deck_section || "pokemon",
        evolution_stage: c.evolution_stage || "",
        limit_type: c.limit_type || "",
      });
    }
  }
  return out;
}

async function hydrateMeta(cards) {
  const ids = [...new Set(cards.map((c) => c.card_id))];
  await Promise.all(
    ids.map(async (id) => {
      try {
        const card = cards.find((c) => c.card_id === id);
        const url = appUrl(
          `/api/card-meta?card_id=${id}&name=${encodeURIComponent(card?.name || "")}`,
        );
        const res = await fetch(url);
        if (!res.ok) return;
        const meta = await res.json();
        for (const c of cards) {
          if (c.card_id !== id) continue;
          if (meta.deck_section) c.deck_section = meta.deck_section;
          if (meta.evolution_stage) c.evolution_stage = meta.evolution_stage;
        }
      } catch {
        /* ignore */
      }
    }),
  );
}

function createFreshState(templates) {
  const deck = shuffle(templates.map(cloneCard));
  return {
    phase: "setup",
    turn: 1,
    deck,
    hand: [],
    prizes: [],
    active: null,
    stadium: null,
    bench: [],
    discard: [],
    selected: null,
    mulliganCount: 0,
    usedSupporter: false,
    attachedEnergyThisTurn: false,
    log: [],
  };
}

function drawCards(n) {
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!state.deck.length) break;
    got.push(state.deck.pop());
  }
  state.hand.push(...got);
  return got;
}

function handHasBasic() {
  return state.hand.some(isBasic);
}

function startOpening() {
  state.hand = [];
  state.prizes = [];
  state.active = null;
  state.stadium = null;
  state.bench = [];
  drawCards(7);
  log(`初期手札7枚を引いた`);
  if (!handHasBasic()) {
    log("たねポケモンがない → マリガン可能");
    setStatus("たねがありません。「マリガン」を押すか手札を確認");
  } else {
    setStatus("手札の【たね】を選んでバトル場の枠をタップ");
  }
}

function doMulligan() {
  state.mulliganCount += 1;
  state.deck = shuffle([...state.deck, ...state.hand]);
  state.hand = [];
  drawCards(7);
  log(`マリガン #${state.mulliganCount}`);
  if (!handHasBasic()) {
    setStatus("まだたねがありません。もう一度マリガンできます");
  } else {
    setStatus("【たね】を選んでバトル場／ベンチ枠をタップ");
  }
  render();
}

function setPrizesIfReady() {
  if (state.prizes.length) {
    setStatus("すでにサイドは置いてあります");
    return false;
  }
  if (!state.active) {
    setStatus("先にバトル場へたねを出してください");
    return false;
  }
  if (state.deck.length < 6) {
    setStatus("山札が足りずサイドを置けません");
    return false;
  }
  for (let i = 0; i < 6; i++) state.prizes.push(state.deck.pop());
  state.phase = "play";
  log("サイド6枚を置いた。ゲーム開始");
  setStatus("対戦中 — カードを選んで操作");
  return true;
}

function findSelected() {
  if (!state?.selected) return null;
  const { zone, uid } = state.selected;
  if (zone === "hand") {
    const i = state.hand.findIndex((c) => c.uid === uid);
    return i >= 0 ? { zone, index: i, card: state.hand[i] } : null;
  }
  if (zone === "active" && state.active?.uid === uid) {
    return { zone, index: 0, card: state.active };
  }
  if (zone === "stadium" && state.stadium?.uid === uid) {
    return { zone, index: 0, card: state.stadium };
  }
  if (zone === "bench") {
    const i = state.bench.findIndex((c) => c.uid === uid);
    return i >= 0 ? { zone, index: i, card: state.bench[i] } : null;
  }
  if (zone === "discard") {
    const i = state.discard.findIndex((c) => c.uid === uid);
    return i >= 0 ? { zone, index: i, card: state.discard[i] } : null;
  }
  return null;
}

function removeFromZone(zone, uid) {
  if (zone === "hand") {
    const i = state.hand.findIndex((c) => c.uid === uid);
    if (i < 0) return null;
    return state.hand.splice(i, 1)[0];
  }
  if (zone === "active" && state.active?.uid === uid) {
    const c = state.active;
    state.active = null;
    return c;
  }
  if (zone === "stadium" && state.stadium?.uid === uid) {
    const c = state.stadium;
    state.stadium = null;
    return c;
  }
  if (zone === "bench") {
    const i = state.bench.findIndex((c) => c.uid === uid);
    if (i < 0) return null;
    return state.bench.splice(i, 1)[0];
  }
  return null;
}

function selectCard(zone, uid) {
  if (state.selected?.zone === zone && state.selected?.uid === uid) {
    state.selected = null;
  } else {
    state.selected = { zone, uid };
    // Prevent the 2nd click of a double-click from hitting newly-rendered action buttons
    if (zone === "hand") armActionButtonsBriefly();
  }
  render();
}

function armActionButtonsBriefly() {
  const targets = [els.handActions, els.actions].filter(Boolean);
  for (const el of targets) el.classList.add("actions-armed");
  if (actionArmTimer) clearTimeout(actionArmTimer);
  actionArmTimer = setTimeout(() => {
    for (const el of targets) el.classList.remove("actions-armed");
    actionArmTimer = null;
  }, 350);
}

function playBasicToActive() {
  const sel = findSelected();
  if (!sel || sel.zone !== "hand" || !isBasic(sel.card)) return;
  if (state.active) {
    setStatus("バトル場にすでにポケモンがいます");
    return;
  }
  const card = removeFromZone("hand", sel.card.uid);
  state.active = card;
  state.selected = null;
  log(`${card.name} をバトル場に出した`);
  setStatus("続けてベンチ枠へたねを出すか、「サイド開始」");
  render();
}

function playBasicToBench() {
  const sel = findSelected();
  if (!sel || sel.zone !== "hand" || !isBasic(sel.card)) return;
  if (!state.active) {
    setStatus("先にバトル場のたねを出してください");
    return;
  }
  if (state.bench.length >= getMaxBench()) {
    setStatus(`ベンチがいっぱいです（最大${getMaxBench()}）`);
    return;
  }
  const card = removeFromZone("hand", sel.card.uid);
  state.bench.push(card);
  state.selected = null;
  log(`${card.name} をベンチに出した`);
  render();
}

function discardSelected() {
  const sel = findSelected();
  if (!sel || (sel.zone !== "hand" && sel.zone !== "active" && sel.zone !== "bench")) return;
  const card = removeFromZone(sel.zone, sel.card.uid);
  if (!card) return;
  if (card.energies?.length) {
    state.discard.push(...card.energies);
    card.energies = [];
  }
  state.discard.push(card);
  state.selected = null;
  log(`${card.name} をトラッシュした`);
  render();
}

function useTrainer() {
  const sel = findSelected();
  if (!sel || sel.zone !== "hand") return;
  if (effectSession) {
    setStatus("効果解決中です");
    return;
  }
  const card = sel.card;
  const section = card.deck_section;
  const isStadium =
    section === "stadium" ||
    (card.name || "").includes("マウンテン") ||
    (card.name || "").includes("スタジアム") ||
    card.name === ZERO_CAVE;
  if (!["goods", "support", "stadium", "tool"].includes(section) && isPokemon(card) && !isStadium) {
    setStatus("トレーナーズを選んでください");
    return;
  }
  if (section === "support") {
    if (state.usedSupporter) {
      setStatus("このターンはすでにサポートを使っています（手動で解除可）");
      return;
    }
    state.usedSupporter = true;
  }

  const effect = TRAINER_EFFECTS[card.name];
  if (effect?.discardFromHand) {
    const others = state.hand.filter((c) => c.uid !== card.uid);
    if (others.length < effect.discardFromHand) {
      setStatus(`${card.name} には追加で手札${effect.discardFromHand}枚のトラッシュが必要です`);
      return;
    }
  }

  const used = removeFromZone("hand", card.uid);
  if (isStadium || section === "stadium") {
    if (state.stadium) {
      state.discard.push(state.stadium);
      log(`スタジアム交代: ${state.stadium.name} → トラッシュ`);
    }
    state.stadium = used;
    state.selected = null;
    log(`${used.name} をスタジアムに置いた`);
    setStatus(`${used.name} を設置（ゼロの大空洞+テラスタルでベンチ8）`);
    render();
    return;
  }

  state.discard.push(used);
  state.selected = null;
  log(`${used.name} を使った`);

  if (!effect) {
    setStatus(`${used.name} の効果は手動で解決してください`);
    render();
    return;
  }

  render();
  if (effect.discardFromHand) openHandDiscard(used.name, effect);
  else openCardPicker(used.name, effect);
}

function effectMax(effect) {
  if (typeof effect.maxDynamic === "function") return Math.max(0, effect.maxDynamic());
  return effect.max ?? 1;
}

function openHandDiscard(effectKey, effect) {
  const need = effect.discardFromHand;
  effectSession = {
    phase: "hand-discard",
    effectKey,
    effect,
    selected: new Set(),
    need,
  };
  els.searchTitle.textContent = `${effect.title}：手札トラッシュ`;
  els.searchHint.textContent = `手札から${need}枚選んでトラッシュしてください`;
  els.searchSkip.textContent = "手札コスト選択中";
  els.searchSkip.disabled = true;
  els.searchConfirm.classList.remove("hidden");
  els.searchConfirm.disabled = true;
  els.searchConfirm.textContent = `トラッシュしてサーチへ（0/${need}）`;
  renderPickerList(state.hand, { selectable: true });
  els.searchModal.classList.remove("hidden");
  setStatus(`${effect.title}: 手札を${need}枚トラッシュ`);
}

function openCardPicker(effectKey, effect) {
  const max = effectMax(effect);
  const sourceCards = effect.source === "hand" ? state.hand : state.deck;
  const matches = sourceCards.filter((c) => effect.filter(c));
  effectSession = {
    phase: "pick",
    effectKey,
    effect,
    matches,
    selected: new Set(),
    max,
  };

  const destLabel = effect.destination === "bench" ? "ベンチへ" : "手札へ";
  els.searchTitle.textContent = effect.title || effectKey;
  els.searchHint.textContent = `${effect.hint || ""}（最大${max}枚 / ${destLabel}）`;
  els.searchSkip.disabled = false;
  els.searchSkip.textContent = effect.shuffleAfter ? "選ばずに閉じる（山札を切る）" : "閉じる";
  const multi = Boolean(effect.multi) || max > 1;
  if (multi) {
    els.searchConfirm.classList.remove("hidden");
    els.searchConfirm.disabled = false;
    els.searchConfirm.textContent = `決定（0/${max}）`;
  } else {
    els.searchConfirm.classList.add("hidden");
  }
  renderPickerList(matches, { selectable: multi, max });
  els.searchModal.classList.remove("hidden");
  setStatus(`${effect.title}: カードを選んでください`);
}

function renderPickerList(cards, { selectable = false, max = 1 } = {}) {
  els.searchList.innerHTML = "";
  const selected = effectSession?.selected || new Set();
  if (!cards.length) {
    const empty = document.createElement("div");
    empty.className = "deck-search-empty";
    empty.textContent = "候補がありません";
    els.searchList.appendChild(empty);
  } else {
    for (const card of cards) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "deck-search-item" + (selected.has(card.uid) ? " selected" : "");
      const img = document.createElement("img");
      img.src = cardImageSrc(card);
      img.alt = card.name;
      img.loading = "lazy";
      const name = document.createElement("span");
      const hp = cardHp(card);
      name.textContent = hp ? `${card.name} (HP${hp})` : card.name;
      btn.appendChild(img);
      btn.appendChild(name);
      btn.addEventListener("click", () => onPickerClick(card.uid, { selectable, max }));
      els.searchList.appendChild(btn);
    }
  }
  const countSrc =
    effectSession?.phase === "hand-discard"
      ? `選択 ${selected.size}/${effectSession.need}`
      : `候補 ${cards.length} / 選択 ${selected.size}/${effectSession?.max ?? 1} / 山札 ${state.deck.length}`;
  els.searchCount.textContent = countSrc;
  if (effectSession?.phase === "hand-discard") {
    els.searchConfirm.disabled = selected.size !== effectSession.need;
    els.searchConfirm.textContent = `トラッシュしてサーチへ（${selected.size}/${effectSession.need}）`;
  } else if (selectable) {
    els.searchConfirm.disabled = false;
    els.searchConfirm.textContent = `決定（${selected.size}/${effectSession.max}）`;
  }
}

function onPickerClick(uid, { selectable, max }) {
  if (!effectSession) return;
  if (effectSession.phase === "hand-discard") {
    const set = effectSession.selected;
    if (set.has(uid)) set.delete(uid);
    else if (set.size < effectSession.need) set.add(uid);
    renderPickerList(state.hand, { selectable: true });
    return;
  }
  if (!selectable) {
    applyPickedUids([uid]);
    return;
  }
  const set = effectSession.selected;
  if (set.has(uid)) set.delete(uid);
  else if (set.size < max) set.add(uid);
  renderPickerList(effectSession.matches, { selectable: true, max });
}

function confirmEffectSession() {
  if (!effectSession) return;
  if (effectSession.phase === "hand-discard") {
    if (effectSession.selected.size !== effectSession.need) return;
    for (const uid of [...effectSession.selected]) {
      const card = removeFromZone("hand", uid);
      if (!card) continue;
      if (card.energies?.length) {
        state.discard.push(...card.energies);
        card.energies = [];
      }
      state.discard.push(card);
      log(`${card.name} をトラッシュ（コスト）`);
    }
    const { effectKey, effect } = effectSession;
    effectSession = null;
    render();
    openCardPicker(effectKey, effect);
    return;
  }
  applyPickedUids([...effectSession.selected]);
}

function applyPickedUids(uids) {
  if (!effectSession) return;
  const { effect } = effectSession;
  const names = [];
  for (const uid of uids) {
    const idx = state.deck.findIndex((c) => c.uid === uid);
    if (idx < 0) continue;
    const [picked] = state.deck.splice(idx, 1);
    if (effect.destination === "bench") {
      if (!state.active) {
        state.deck.splice(idx, 0, picked);
        setStatus("先にバトル場のたねが必要です");
        continue;
      }
      if (state.bench.length >= getMaxBench()) {
        state.deck.splice(idx, 0, picked);
        setStatus(`ベンチ上限（${getMaxBench()}）に達しました`);
        break;
      }
      state.bench.push(picked);
      names.push(picked.name);
      log(`${picked.name} をベンチに出した`);
    } else {
      state.hand.push(picked);
      names.push(picked.name);
      if (effect.reveal) log(`${picked.name} を相手に見せて手札に加えた`);
      else log(`${picked.name} を手札に加えた`);
    }
  }
  closeEffectSession({
    shouldShuffle: Boolean(effect.shuffleAfter),
    summary: names.length ? names.join("、") : "",
  });
}

function closeEffectSession({ shouldShuffle = false, summary = "" } = {}) {
  els.searchModal.classList.add("hidden");
  els.searchList.innerHTML = "";
  els.searchConfirm.classList.add("hidden");
  els.searchSkip.disabled = false;
  effectSession = null;
  if (shouldShuffle) {
    state.deck = shuffle(state.deck);
    log("山札をシャッフルした");
  }
  if (summary) setStatus(`${summary} を解決`);
  else if (shouldShuffle) setStatus("カードを選ばず山札を切った");
  render();
}

function skipEffectSession() {
  if (!effectSession || effectSession.phase === "hand-discard") return;
  const { effect } = effectSession;
  log(`${effect.title}: カードを選ばなかった`);
  closeEffectSession({ shouldShuffle: Boolean(effect.shuffleAfter) });
}

function attachEnergyTo(targetZone, targetUid) {
  const sel = findSelected();
  if (!sel || sel.zone !== "hand" || !isEnergy(sel.card)) return;
  if (state.attachedEnergyThisTurn) {
    setStatus("このターンはすでにエネルギーをつけています（手動ルール）");
    return;
  }
  let target = null;
  if (targetZone === "active" && state.active?.uid === targetUid) target = state.active;
  if (targetZone === "bench") target = state.bench.find((c) => c.uid === targetUid);
  if (!target) {
    setStatus("エネルギーをつけるポケモンを指定できません");
    return;
  }
  const ene = removeFromZone("hand", sel.card.uid);
  target.energies.push(ene);
  state.attachedEnergyThisTurn = true;
  state.selected = null;
  log(`${ene.name} を ${target.name} につけた`);
  render();
}

function evolveOnto(targetZone, targetUid) {
  const sel = findSelected();
  if (!sel || sel.zone !== "hand" || !isPokemon(sel.card)) return;
  let target = null;
  if (targetZone === "active" && state.active?.uid === targetUid) target = state.active;
  if (targetZone === "bench") {
    const i = state.bench.findIndex((c) => c.uid === targetUid);
    if (i >= 0) target = state.bench[i];
  }
  if (!target || !canEvolveOnto(sel.card, target)) {
    setStatus("このカードでは進化できません");
    return;
  }
  const evo = removeFromZone("hand", sel.card.uid);
  evo.damage = target.damage;
  evo.energies = target.energies.slice();
  target.energies = [];
  state.discard.push(target);
  if (targetZone === "active") state.active = evo;
  else {
    const i = state.bench.findIndex((c) => c.uid === targetUid);
    state.bench[i] = evo;
  }
  state.selected = null;
  log(`${target.name} → ${evo.name} に進化`);
  render();
}

function retreatToBench(benchIndex) {
  if (!state.active) return;
  if (benchIndex < 0 || benchIndex >= state.bench.length) return;
  const out = state.bench.splice(benchIndex, 1)[0];
  state.bench.push(state.active);
  state.active = out;
  state.selected = null;
  log(`バトル場を交代: ${out.name}`);
  render();
}

function adjustDamage(zone, uid, delta) {
  let card = null;
  if (zone === "active" && state.active?.uid === uid) card = state.active;
  if (zone === "bench") card = state.bench.find((c) => c.uid === uid);
  if (!card) return;
  card.damage = Math.max(0, card.damage + delta);
  log(`${card.name} のダメカン ${delta > 0 ? "+" : ""}${delta} → ${card.damage}`);
  render();
}

function takePrize() {
  if (!state.prizes.length) {
    setStatus("サイドがありません");
    return;
  }
  const card = state.prizes.pop();
  state.hand.push(card);
  log(`サイドを1枚取った: ${card.name}`);
  if (!state.prizes.length) {
    log("サイドを取り切った（勝利条件）");
    setStatus("サイド0 — 勝利！");
  }
  render();
}

function startTurnDraw() {
  const got = drawCards(1);
  if (got.length) log(`ドロー: ${got[0].name}`);
  else log("山札がなくドローできない");
  render();
}

function endTurn() {
  state.turn += 1;
  state.usedSupporter = false;
  state.attachedEnergyThisTurn = false;
  state.selected = null;
  log(`—— ターン ${state.turn} ——`);
  setStatus(`ターン ${state.turn}`);
  render();
}

function selectedHandBasic() {
  const sel = findSelected();
  if (!sel || sel.zone !== "hand" || !isBasic(sel.card)) return null;
  return sel.card;
}

function playBasicToActiveFromUid(uid) {
  const card = state.hand.find((c) => c.uid === uid);
  if (!card || !isBasic(card)) return;
  if (state.active) {
    setStatus("バトル場にすでにポケモンがいます → ベンチ枠をタップ");
    return;
  }
  state.selected = { zone: "hand", uid };
  playBasicToActive();
}

function playBasicToBenchFromUid(uid) {
  const card = state.hand.find((c) => c.uid === uid);
  if (!card || !isBasic(card)) return;
  state.selected = { zone: "hand", uid };
  playBasicToBench();
}

function tryAutoPlayBasic(uid) {
  const card = state.hand.find((c) => c.uid === uid);
  if (!card || !isBasic(card)) return;
  if (!state.active) playBasicToActiveFromUid(uid);
  else playBasicToBenchFromUid(uid);
}

function renderDropSlot(label, enabled, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "drop-slot" + (enabled ? " drop-ready" : "");
  btn.textContent = label;
  btn.disabled = !enabled;
  if (enabled) btn.addEventListener("click", onClick);
  return btn;
}

function renderCardButton(card, zone, opts = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "battle-card";
  if (state.selected?.zone === zone && state.selected?.uid === card.uid) {
    btn.classList.add("selected");
  }
  if (zone === "hand" && isBasic(card)) {
    btn.classList.add("is-basic");
  }
  if (opts.faceDown) {
    btn.classList.add("face-down");
    btn.title = "サイド";
    btn.disabled = true;
  } else {
    const img = document.createElement("img");
    img.src = cardImageSrc(card);
    img.alt = card.name;
    img.loading = "lazy";
    btn.appendChild(img);
    const label = document.createElement("span");
    label.className = "card-label";
    label.textContent = card.name;
    btn.appendChild(label);
    if (zone === "hand" && isBasic(card)) {
      const badge = document.createElement("span");
      badge.className = "basic-badge";
      badge.textContent = "たね";
      btn.appendChild(badge);
    }
    if (card.damage > 0) {
      const d = document.createElement("span");
      d.className = "dmg-badge";
      d.textContent = String(card.damage);
      btn.appendChild(d);
    }
    if (card.energies?.length) {
      const e = document.createElement("span");
      e.className = "ene-badge";
      e.textContent = `E${card.energies.length}`;
      btn.appendChild(e);
    }
    if (card.terastal) {
      const t = document.createElement("span");
      t.className = "basic-badge";
      t.textContent = "Tera";
      t.style.left = "auto";
      t.style.right = "2px";
      t.style.top = "18px";
      btn.appendChild(t);
    }
  }
  btn.addEventListener("click", () => selectCard(zone, card.uid));
  return btn;
}

function fillActionButtons(container, sel) {
  container.innerHTML = "";
  if (!sel) {
    const p = document.createElement("p");
    p.className = "hint";
    p.textContent = "手札のたねを選んで、バトル場／ベンチ枠をタップ";
    container.appendChild(p);
    return;
  }

  const add = (label, fn, primary = false) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = primary ? "btn btn-primary btn-sm" : "btn btn-ghost btn-sm";
    b.textContent = label;
    b.addEventListener("click", fn);
    container.appendChild(b);
  };

  const { card, zone } = sel;
  const info = document.createElement("p");
  info.className = "hint";
  info.textContent = `${card.name}`;
  container.appendChild(info);

  if (zone === "hand") {
    if (isBasic(card)) {
      if (!state.active) add("→ バトル場", playBasicToActive, true);
      if (state.active) add("→ ベンチ", playBasicToBench, true);
      else add("→ ベンチ", playBasicToBench);
    }
    if (isEnergy(card)) {
      if (state.active) {
        add(`エネ→${state.active.name}`, () =>
          attachEnergyTo("active", state.active.uid), true);
      }
      state.bench.forEach((b) => {
        add(`エネ→${b.name}`, () => attachEnergyTo("bench", b.uid));
      });
    }
    if (EVOLVES_FROM[card.name]) {
      if (state.active && canEvolveOnto(card, state.active)) {
        add(`進化→${state.active.name}`, () =>
          evolveOnto("active", state.active.uid), true);
      }
      state.bench.forEach((b) => {
        if (canEvolveOnto(card, b)) {
          add(`進化→${b.name}`, () => evolveOnto("bench", b.uid));
        }
      });
    }
    if (
      ["goods", "support", "stadium", "tool"].includes(card.deck_section) ||
      (!isPokemon(card) && !isEnergy(card))
    ) {
      const label =
        card.deck_section === "stadium" || (card.name || "").includes("マウンテン")
          ? "スタジアムに置く"
          : TRAINER_EFFECTS[card.name]
            ? "使う（効果解決）"
            : "使う";
      add(label, useTrainer, true);
    }
    add("トラッシュ", discardSelected);
  }

  if (zone === "active" || zone === "bench") {
    add("ダメ+10", () => adjustDamage(zone, card.uid, 10));
    add("ダメ+30", () => adjustDamage(zone, card.uid, 30));
    add("ダメ-10", () => adjustDamage(zone, card.uid, -10));
    add(card.terastal ? "テラスタル解除" : "テラスタルON", () => {
      card.terastal = !card.terastal;
      log(`${card.name} のテラスタルを${card.terastal ? "ON" : "OFF"}`);
      setStatus(`ベンチ上限: ${getMaxBench()}（ゼロの大空洞+テラスタルで8）`);
      render();
    });
    if (zone === "bench") {
      const idx = state.bench.findIndex((c) => c.uid === card.uid);
      add("バトルへ", () => retreatToBench(idx), true);
    }
    if (zone === "stadium") {
      add("トラッシュへ", discardSelected, true);
    } else {
      add("トラッシュ", discardSelected);
    }
  }
}

function renderActions() {
  const sel = findSelected();
  fillActionButtons(els.actions, sel);
  if (els.handActions) {
    if (sel?.zone === "hand") fillActionButtons(els.handActions, sel);
    else els.handActions.innerHTML = "";
  }
}

function renderZone(el, cards, zone, opts = {}) {
  el.innerHTML = "";
  const handBasic = selectedHandBasic();

  if (zone === "active") {
    if (cards.length) {
      el.appendChild(renderCardButton(cards[0], zone, opts));
    } else {
      el.appendChild(
        renderDropSlot(
          handBasic ? "ここに出す" : "バトル場",
          Boolean(handBasic && !state.active),
          () => playBasicToActiveFromUid(handBasic.uid),
        ),
      );
    }
    return;
  }

  if (zone === "stadium") {
    if (state.stadium) {
      el.appendChild(renderCardButton(state.stadium, "stadium", opts));
    } else {
      const empty = document.createElement("div");
      empty.className = "empty-slot";
      empty.textContent = "空";
      el.appendChild(empty);
    }
    return;
  }

  if (zone === "bench") {
    for (let i = 0; i < BENCH_SLOTS; i++) {
      const card = state.bench[i];
      if (card) {
        el.appendChild(renderCardButton(card, "bench", opts));
      } else {
        const canDrop =
          Boolean(handBasic && state.active && state.bench.length < getMaxBench()) &&
          i === state.bench.length;
        el.appendChild(
          renderDropSlot(
            canDrop ? "ベンチへ" : "",
            canDrop,
            () => playBasicToBenchFromUid(handBasic.uid),
          ),
        );
      }
    }
    return;
  }

  if (zone === "prizes") {
    for (let i = 0; i < 6; i++) {
      const card = cards[i];
      if (card) {
        el.appendChild(renderCardButton(card, "prizes", { faceDown: true }));
      } else {
        const empty = document.createElement("div");
        empty.className = "battle-card face-down";
        empty.style.opacity = "0.25";
        empty.setAttribute("aria-hidden", "true");
        el.appendChild(empty);
      }
    }
    return;
  }

  if (zone === "discard") {
    if (!cards.length) {
      const empty = document.createElement("div");
      empty.className = "empty-slot";
      empty.textContent = "空";
      el.appendChild(empty);
      return;
    }
    const top = cards[cards.length - 1];
    el.appendChild(renderCardButton(top, "discard", opts));
    return;
  }

  if (!cards.length) {
    const empty = document.createElement("div");
    empty.className = "empty-slot";
    empty.textContent = opts.empty || "なし";
    el.appendChild(empty);
    return;
  }
  for (const card of cards) {
    el.appendChild(renderCardButton(card, zone, opts));
  }
}

function render() {
  if (!state) return;
  els.turnLabel.textContent = `ターン ${state.turn}`;
  els.countDeck.textContent = String(state.deck.length);
  els.countPrize.textContent = String(state.prizes.length);
  els.countDiscard.textContent = String(state.discard.length);
  els.countMulligan.textContent = String(state.mulliganCount);
  els.countHand.textContent = String(state.hand.length);
  const benchMaxEl = document.getElementById("count-bench-max");
  if (benchMaxEl) benchMaxEl.textContent = String(getMaxBench());
  if (els.deckPile) {
    els.deckPile.disabled = state.deck.length === 0;
  }

  if (els.active) renderZone(els.active, state.active ? [state.active] : [], "active");
  if (els.stadium) renderZone(els.stadium, state.stadium ? [state.stadium] : [], "stadium");
  if (els.bench) renderZone(els.bench, state.bench, "bench");
  if (els.hand) renderZone(els.hand, state.hand, "hand", { empty: "手札なし" });
  if (els.prizes) renderZone(els.prizes, state.prizes, "prizes");
  if (els.discard) renderZone(els.discard, state.discard, "discard");

  els.log.innerHTML = "";
  for (const line of state.log.slice(0, 40)) {
    const li = document.createElement("li");
    li.textContent = line;
    els.log.appendChild(li);
  }

  renderActions();
}

async function loadFromApiCards(cards, label) {
  if (!cards?.length) {
    setStatus("カードがありません");
    return;
  }
  setStatus("カード情報を取得中...");
  const expanded = expandDeckList(cards);
  const total = expanded.length;
  if (total !== 60 && total !== 30) {
    setStatus(`枚数が ${total} です（60 or 30 推奨）。そのまま続行します`);
  }
  await hydrateMeta(expanded);
  catalog = expanded;
  els.newGame.disabled = false;
  els.main.classList.remove("hidden");
  state = createFreshState(catalog);
  startOpening();
  log(`デッキ読み込み: ${label}（${catalog.length}枚）`);
  render();
  if (total === 60 || total === 30) setStatus("初期手札を配りました");
}

async function loadDeckCode() {
  const code = (els.code.value || "").trim();
  if (!code) {
    setStatus("デッキコードを入力してください");
    return;
  }
  els.load.disabled = true;
  setStatus("公式サイトから読み込み中...");
  try {
    const res = await fetch(appUrl(`/api/deck-import?code=${encodeURIComponent(code)}`));
    const data = await res.json();
    if (!res.ok || data.error) {
      setStatus(data.message || "読み込みに失敗しました");
      return;
    }
    await loadFromApiCards(data.cards, code);
  } catch {
    setStatus("読み込みに失敗しました");
  } finally {
    els.load.disabled = false;
  }
}

async function loadBuilderDeck() {
  try {
    const raw = localStorage.getItem(BUILDER_DECK_KEY);
    if (!raw) {
      setStatus("ビルダーに保存されたデッキがありません");
      return;
    }
    const parsed = JSON.parse(raw);
    const entries = parsed.entries || [];
    const cards = entries.map(([, entry]) => ({
      ...entry.card,
      qty: entry.qty,
    }));
    await loadFromApiCards(cards, "ビルダーデッキ");
  } catch {
    setStatus("ビルダーデッキの読み込みに失敗しました");
  }
}

function newGame() {
  if (!catalog.length) return;
  state = createFreshState(catalog);
  startOpening();
  log("新規ゲーム");
  render();
}

els.load.addEventListener("click", loadDeckCode);
els.loadBuilder.addEventListener("click", loadBuilderDeck);
els.newGame.addEventListener("click", newGame);
els.draw.addEventListener("click", startTurnDraw);
els.endTurn.addEventListener("click", endTurn);
if (els.deckPile) {
  els.deckPile.addEventListener("click", () => {
    if (!state || !state.deck.length) return;
    startTurnDraw();
  });
}
els.code.value = PRESET_CODE;
if (els.searchSkip) {
  els.searchSkip.addEventListener("click", skipEffectSession);
}
if (els.searchConfirm) {
  els.searchConfirm.addEventListener("click", confirmEffectSession);
}

document.querySelectorAll("[data-quick]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!state || effectSession) return;
    const q = btn.getAttribute("data-quick");
    if (q === "start-prizes") {
      setPrizesIfReady();
      render();
    }
    if (q === "prize") takePrize();
    if (q === "mulligan") doMulligan();
    if (q === "shuffle-hand") {
      state.deck = shuffle([...state.deck, ...state.hand]);
      state.hand = [];
      log("手札を山札に戻してシャッフル");
      render();
    }
  });
});
