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

let uidSeq = 1;
let catalog = []; // expanded card templates from loaded deck
let state = null;

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
  oppName: document.getElementById("opp-name"),
  oppHpLeft: document.getElementById("opp-hp-left"),
  oppHpMax: document.getElementById("opp-hp-max"),
  oppFill: document.getElementById("opp-damage-fill"),
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
    bench: [],
    discard: [],
    selected: null,
    mulliganCount: 0,
    usedSupporter: false,
    attachedEnergyThisTurn: false,
    opponent: { name: "壁ポケモン", hp: 280, damage: 0 },
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
  state.bench = [];
  drawCards(7);
  log(`初期手札7枚を引いた`);
  if (!handHasBasic()) {
    log("たねポケモンがない → マリガン可能");
    setStatus("たねがありません。「マリガン」を押すか手札を確認");
  } else {
    setStatus("手札の【たね】を選んでバトル場の枠をタップ（ダブルクリックでもOK）");
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
    setStatus("【たね】を選んでバトル場／ベンチ枠へ");
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
  }
  render();
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
  if (state.bench.length >= 5) {
    setStatus("ベンチがいっぱいです");
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
  const card = sel.card;
  const section = card.deck_section;
  if (!["goods", "support", "stadium", "tool"].includes(section) && isPokemon(card)) {
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
  const used = removeFromZone("hand", card.uid);
  state.discard.push(used);
  state.selected = null;
  log(`${used.name} を使った（効果は自分で解決）`);
  setStatus(`${used.name} の効果を解決してください`);
  render();
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

function oppDamage(delta) {
  state.opponent.damage = Math.max(0, state.opponent.damage + delta);
  const left = Math.max(0, state.opponent.hp - state.opponent.damage);
  log(`相手ダメ ${delta > 0 ? "+" : ""}${delta}（残HP ${left}）`);
  if (left <= 0) {
    log("相手をきぜつさせた");
    setStatus("相手きぜつ — サイドを取ってください");
  }
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
  }
  btn.addEventListener("click", () => selectCard(zone, card.uid));
  if (zone === "hand" && isBasic(card)) {
    btn.title = "クリックで選択 / ダブルクリックで場に出す";
    btn.addEventListener("dblclick", (ev) => {
      ev.preventDefault();
      tryAutoPlayBasic(card.uid);
    });
  }
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
      add("使う", useTrainer, true);
    }
    add("トラッシュ", discardSelected);
  }

  if (zone === "active" || zone === "bench") {
    add("ダメ+10", () => adjustDamage(zone, card.uid, 10));
    add("ダメ+30", () => adjustDamage(zone, card.uid, 30));
    add("ダメ-10", () => adjustDamage(zone, card.uid, -10));
    if (zone === "bench") {
      const idx = state.bench.findIndex((c) => c.uid === card.uid);
      add("バトルへ", () => retreatToBench(idx), true);
    }
    add("トラッシュ", discardSelected);
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

  if (zone === "active" && !cards.length) {
    el.appendChild(
      renderDropSlot(
        handBasic ? "ここにバトル場へ" : "空（たねを選択）",
        Boolean(handBasic && !state.active),
        () => playBasicToActiveFromUid(handBasic.uid),
      ),
    );
    return;
  }

  if (zone === "bench") {
    for (const card of cards) {
      el.appendChild(renderCardButton(card, zone, opts));
    }
    if (cards.length < 5) {
      el.appendChild(
        renderDropSlot(
          handBasic && state.active ? "ベンチへ" : "空枠",
          Boolean(handBasic && state.active && state.bench.length < 5),
          () => playBasicToBenchFromUid(handBasic.uid),
        ),
      );
    }
    if (!cards.length && !(handBasic && state.active)) {
      // drop slot already added; ok
    }
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

  const left = Math.max(0, state.opponent.hp - state.opponent.damage);
  els.oppName.textContent = state.opponent.name;
  els.oppHpLeft.textContent = String(left);
  els.oppHpMax.textContent = String(state.opponent.hp);
  els.oppFill.style.width = `${Math.min(100, (state.opponent.damage / state.opponent.hp) * 100)}%`;

  if (state.active) {
    renderZone(els.active, [state.active], "active");
  } else {
    renderZone(els.active, [], "active", { empty: "たねを出してください" });
  }
  renderZone(els.bench, state.bench, "bench", { empty: "空" });
  renderZone(els.hand, state.hand, "hand", { empty: "手札なし" });
  renderZone(els.prizes, state.prizes, "prizes", { faceDown: true, empty: "未配置" });
  renderZone(els.discard, state.discard.slice(-8).reverse(), "discard", { empty: "空" });

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
els.code.value = PRESET_CODE;

document.querySelectorAll("[data-quick]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!state) return;
    const q = btn.getAttribute("data-quick");
    if (q === "start-prizes") {
      setPrizesIfReady();
      render();
    }
    if (q === "prize") takePrize();
    if (q === "opp-dmg-30") oppDamage(30);
    if (q === "opp-dmg-10") oppDamage(10);
    if (q === "opp-heal-30") oppDamage(-30);
    if (q === "mulligan") doMulligan();
    if (q === "shuffle-hand") {
      state.deck = shuffle([...state.deck, ...state.hand]);
      state.hand = [];
      log("手札を山札に戻してシャッフル");
      render();
    }
  });
});
