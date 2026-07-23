import {
  canChangeQty,
  collectWarnings,
  countByName,
  getLimitGroup,
  getLimitType,
  totalCards,
  DECK_SIZE,
  VALID_DECK_SIZES,
  NAME_LIMIT,
} from "./rules.js";
import { formatCardName } from "./cardText.js";
import { createCardThumb } from "./cardImage.js";
import { renderDeckListImage } from "./deckImage.js";
import {
  buildBanIndex,
  collectRegulationWarnings,
  enrichCard,
  getFormatConfig,
  isLegalInFormat,
  isBanned,
  getBanEntry,
  REGULATION_MARKS,
} from "./regulation.js";

import {
  DECK_SECTIONS,
  createEmptyDeckOrder,
  getDeckSection,
  groupDeckBySection,
  moveInSectionOrder,
  syncDeckOrder,
} from "./deckSections.js";
import { appUrl } from "./paths.js";

const STORAGE_KEY = "pokeca-deck-builder-v2";
const LEGACY_STORAGE_KEY = "pokeca-deck-builder-v1";
const SEARCH_LIMIT_KEY = "pokeca-deck-search-limit-v1";
const MOBILE_VIEW_KEY = "pokeca-mobile-view-v1";
const SPECIAL_MARKS_KEY = "pokeca-special-marks-v1";
const BAN_LIST_KEY = "pokeca-ban-list-v1";
const DECK_SIZE_KEY = "pokeca-deck-size-v1";
const MOBILE_BREAKPOINT = "(max-width: 768px)";
const VALID_FORMATS = ["standard", "extra", "special", "all"];
const VALID_SEARCH_LIMITS = [10, 50, 100];

const layoutEl = document.querySelector(".layout");
const mobileViewSwitcher = document.getElementById("mobile-view-switcher");
const mobileDeckBadge = document.getElementById("mobile-deck-badge");
const mobileMq = window.matchMedia(MOBILE_BREAKPOINT);
const formatSelect = document.getElementById("format-select");
const banListSelect = document.getElementById("ban-list-select");
const specialMarksPanel = document.getElementById("special-marks-panel");
const specialMarksEl = document.getElementById("special-marks");

const searchInput = document.getElementById("search-input");
const searchStatus = document.getElementById("search-status");
const searchResults = document.getElementById("search-results");
const searchPagination = document.getElementById("search-pagination");
const searchLimitSelect = document.getElementById("search-limit");
const deckList = document.getElementById("deck-list");
const deckCount = document.getElementById("deck-count");
const deckSizeSelect = document.getElementById("deck-size-select");
const deckWarning = document.getElementById("deck-warning");
const deckEmpty = document.getElementById("deck-empty");
const clearDeckBtn = document.getElementById("clear-deck");
const deckCodeInput = document.getElementById("deck-code-input");
const deckCodeImportBtn = document.getElementById("deck-code-import");
const deckCodeStatus = document.getElementById("deck-code-status");
const deckCodeExportBtn = document.getElementById("deck-code-export");
const deckImageExportBtn = document.getElementById("deck-image-export");
const deckImagePanel = document.getElementById("deck-image-panel");
const deckImagePreview = document.getElementById("deck-image-preview");
const deckImageDownload = document.getElementById("deck-image-download");
const deckImageCloseBtn = document.getElementById("deck-image-close");
const deckExportPanel = document.getElementById("deck-export-panel");
const deckCodeOutput = document.getElementById("deck-code-output");
const deckCodeCopyBtn = document.getElementById("deck-code-copy");

/** @type {Map<number, { card: object, qty: number }>} */
let deckState = loadDeckState();
let deck = deckState.deck;
/** @type {Record<string, number[]>} */
let deckOrder = deckState.deckOrder;
/** @type {object|null} */
let regulationConfig = null;
/** @type {{ entries: object[], updated: string|null }} */
let banData = { entries: [], updated: null };
/** @type {Set<string>} */
let specialMarks = loadSpecialMarks();
/** @type {string} */
let selectedBanList = localStorage.getItem(BAN_LIST_KEY) || "";
/** @type {Map<number, string>} */
let customBanNames = new Map();
/** @type {Set<number>} */
let customBanIds = new Set();
let searchTimer = null;
let searchPage = 1;
let searchLimit = loadSearchLimit();
let lastSearchQuery = "";
let currentFormat = "standard";
/** @type {number} */
let deckSize = loadDeckSize();

function loadDeckSize() {
  const stored = Number(localStorage.getItem(DECK_SIZE_KEY));
  if (VALID_DECK_SIZES.includes(stored)) return stored;
  return DECK_SIZE;
}

function saveDeckSize() {
  localStorage.setItem(DECK_SIZE_KEY, String(deckSize));
}

function loadSpecialMarks() {
  try {
    const raw = JSON.parse(localStorage.getItem(SPECIAL_MARKS_KEY) || "null");
    if (Array.isArray(raw)) {
      const marks = raw.filter((m) => REGULATION_MARKS.includes(m));
      if (marks.length) return new Set(marks);
    }
  } catch {
    // ignore
  }
  return new Set(["D", "E", "F", "G", "H", "I", "J"]);
}

function saveSpecialMarks() {
  localStorage.setItem(SPECIAL_MARKS_KEY, JSON.stringify([...specialMarks]));
}

function loadSearchLimit() {
  const stored = Number(localStorage.getItem(SEARCH_LIMIT_KEY));
  if (VALID_SEARCH_LIMITS.includes(stored)) return stored;
  return mobileMq.matches ? 10 : 50;
}

function isMobileLayout() {
  return mobileMq.matches;
}

function setMobileView(view) {
  if (!layoutEl) return;
  const nextView = view === "deck" ? "deck" : "search";
  layoutEl.classList.remove("view-search", "view-deck");
  layoutEl.classList.add(nextView === "deck" ? "view-deck" : "view-search");

  for (const btn of mobileViewSwitcher?.querySelectorAll(".mobile-view-btn") || []) {
    const active = btn.dataset.view === nextView;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-current", active ? "page" : "false");
  }

  localStorage.setItem(MOBILE_VIEW_KEY, nextView);
  document.body.classList.toggle("mobile-deck-view", nextView === "deck");
}

function syncMobileLayout() {
  if (!isMobileLayout()) {
    layoutEl?.classList.remove("view-search", "view-deck");
    document.body.classList.remove("mobile-deck-view");
    return;
  }

  const saved = localStorage.getItem(MOBILE_VIEW_KEY);
  setMobileView(saved === "deck" ? "deck" : "search");
}

function updateMobileDeckBadge(total) {
  if (!mobileDeckBadge) return;
  mobileDeckBadge.textContent = String(total);
  mobileDeckBadge.classList.toggle("complete", total === deckSize);
  mobileDeckBadge.classList.toggle("incomplete", total > 0 && total !== deckSize);
}

function loadDeckState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      const entries = data.entries || [];
      const loadedDeck = new Map(entries.map(([id, value]) => [Number(id), value]));
      const order = data.deckOrder || createEmptyDeckOrder();
      return { deck: loadedDeck, deckOrder: syncDeckOrder(order, loadedDeck) };
    }

    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const entries = JSON.parse(legacy);
      const loadedDeck = new Map(entries.map(([id, value]) => [Number(id), value]));
      return {
        deck: loadedDeck,
        deckOrder: syncDeckOrder(createEmptyDeckOrder(), loadedDeck),
      };
    }
  } catch {
    // ignore
  }
  return { deck: new Map(), deckOrder: createEmptyDeckOrder() };
}

function saveDeck() {
  deckOrder = syncDeckOrder(deckOrder, deck);
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ entries: [...deck.entries()], deckOrder })
  );
}

async function ensureCardMeta(card) {
  if (card.deck_section) return card;
  try {
    const params = new URLSearchParams({
      card_id: String(card.card_id),
      name: card.name || "",
    });
    const res = await fetch(appUrl(`/api/card-meta?${params}`));
    if (!res.ok) return card;
    const meta = await res.json();
    return { ...card, ...meta };
  } catch {
    return card;
  }
}

function getRegConfig() {
  const banIndex = buildBanIndex(banData.entries);
  const base = regulationConfig
    ? {
        ...regulationConfig,
        trainerWhitelist: new Set(regulationConfig.trainerWhitelist || []),
        setRegulationMap: regulationConfig.setRegulationMap || {},
        cardRegulationMarks: regulationConfig.cardRegulationMarks || {},
        formatLegal: regulationConfig.formatLegal || { standard: {}, extra: {} },
        nameRegulationMarks: regulationConfig.nameRegulationMarks || {},
        bannedByFormat: banIndex.byFormat,
        banDetails: banIndex.details,
      }
    : {
        formats: {
          standard: { label: "スタンダード", marks: ["H", "I", "J"] },
          extra: { label: "エクストラ", marks: REGULATION_MARKS },
          special: { label: "特殊", marks: REGULATION_MARKS },
          all: { label: "すべて", marks: [] },
        },
        trainerWhitelist: new Set(),
        setRegulationMap: {},
        cardRegulationMarks: {},
        formatLegal: { standard: {}, extra: {} },
        nameRegulationMarks: {},
        bannedByFormat: banIndex.byFormat,
        banDetails: banIndex.details,
      };

  return {
    ...base,
    specialMarks,
    customBanIds,
    customBanNames,
    customBanListName: selectedBanList || "",
  };
}

function normalizeDeckCards() {
  const config = getRegConfig();
  for (const entry of deck.values()) {
    entry.card = enrichCard(entry.card, config);
  }
}

function formatDeckSetLabel(card) {
  const parts = [];
  if (card.set_code) parts.push(card.set_code);
  if (card.number_label) parts.push(card.number_label);
  return parts.join(" · ");
}

function legalityBadge(card) {
  const config = getRegConfig();
  if (!isBanned(card, currentFormat, config)) return "";
  const entry = getBanEntry(card, currentFormat, config);
  const label = entry?.note ? `禁止: ${entry.note}` : "禁止";
  return `<span class="badge badge-banned">${escapeHtml(label)}</span>`;
}

function nameLimitText(card) {
  const type = getLimitType(card);
  const name = getLimitGroup(card);
  if (type === "basic_energy") return "";
  if (type === "prism_star" || type === "radiant" || type === "ace_spec") {
    return "デッキ1枚";
  }
  const qty = countByName(deck, name);
  return `同名 ${qty}/${NAME_LIMIT}`;
}

function renderSearchResults(data) {
  const cards = data.cards || [];
  searchResults.innerHTML = "";

  if (!cards.length) {
    searchStatus.textContent =
      data.total > 0 ? "このページに表示するカードがありません" : "該当するカードがありません";
    renderSearchPagination(data);
    return;
  }

  const from = (data.page - 1) * data.limit + 1;
  const to = from + cards.length - 1;
  searchStatus.textContent = `${data.total}件中 ${from}–${to}件を表示`;

  const config = getRegConfig();
  for (const card of cards) {
    const li = document.createElement("li");
    li.className = "card-item";

    const legal = isLegalInFormat(card, currentFormat, config);
    const qtyCheck = canChangeQty(deck, card, 1);
    const canAdd = legal && qtyCheck.ok;
    let blockedReason = "";
    if (!legal) {
      if (currentFormat === "special") {
        blockedReason = "特殊では使用不可（同名カードに選択中レギュの版なし）";
      } else {
        blockedReason = `${getFormatConfig(config, currentFormat).label}では使用不可`;
      }
    } else if (!qtyCheck.ok) {
      blockedReason = qtyCheck.reason;
    }

    if (!canAdd) {
      li.classList.add("card-item-disabled");
      li.title = blockedReason;
    } else {
      li.classList.add("card-item-clickable");
      li.title = "タップしてデッキに追加";
    }

    const thumb = createCardThumb(card);
    if (thumb) {
      thumb.classList.add("search-thumb");
      li.appendChild(thumb);
    }

    const name = document.createElement("div");
    name.className = "card-name search-card-name";
    name.innerHTML = `${escapeHtml(formatCardName(card.name))}${legalityBadge(card)}`;
    li.appendChild(name);

    const setLabel = formatDeckSetLabel(card);
    if (setLabel) {
      const detail = document.createElement("div");
      detail.className = "card-detail search-card-set";
      detail.textContent = setLabel;
      li.appendChild(detail);
    }

    li.addEventListener("click", () => {
      if (!canAdd) {
        alert(blockedReason || "追加できません");
        return;
      }
      addCard(card);
    });

    searchResults.appendChild(li);
  }

  renderSearchPagination(data);
}

function renderSearchPagination(data) {
  searchPagination.innerHTML = "";
  const total = data.total || 0;
  const page = data.page || 1;
  const maxPage = data.maxPage || 1;

  if (total <= 0) {
    searchPagination.classList.add("hidden");
    return;
  }

  searchPagination.classList.toggle("hidden", maxPage <= 1);

  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "btn btn-ghost";
  prevBtn.textContent = "前へ";
  prevBtn.disabled = page <= 1;
  prevBtn.addEventListener("click", () => {
    if (searchPage > 1) {
      searchPage -= 1;
      runSearch(lastSearchQuery, { keepPage: true });
    }
  });

  const info = document.createElement("span");
  info.className = "search-pagination-info";
  info.textContent = `${page} / ${maxPage}`;

  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "btn btn-ghost";
  nextBtn.textContent = "次へ";
  nextBtn.disabled = page >= maxPage;
  nextBtn.addEventListener("click", () => {
    if (searchPage < maxPage) {
      searchPage += 1;
      runSearch(lastSearchQuery, { keepPage: true });
    }
  });

  searchPagination.append(prevBtn, info, nextBtn);
}

function renderDeck() {
  deckList.innerHTML = "";
  deckOrder = syncDeckOrder(deckOrder, deck);
  const grouped = groupDeckBySection(deck, deckOrder);
  const config = getRegConfig();
  let hasCards = false;

  for (const section of DECK_SECTIONS) {
    const entries = grouped[section.id];
    if (!entries.length) continue;
    hasCards = true;

    const sectionCards = entries.reduce((sum, entry) => sum + entry.qty, 0);
    const sectionEl = document.createElement("section");
    sectionEl.className = "deck-section";

    const title = document.createElement("h3");
    title.className = "deck-section-title";
    title.textContent = `${section.label}（${sectionCards}枚）`;
    sectionEl.appendChild(title);

    const list = document.createElement("ul");
    list.className = "deck-list";

    for (let i = 0; i < entries.length; i += 1) {
      const { card, qty } = entries[i];
      const li = document.createElement("li");
      li.className = "deck-item";
      const illegal =
        isBanned(card, currentFormat, config) ||
        !isLegalInFormat(card, currentFormat, config);
      if (illegal) {
        li.classList.add("deck-item-illegal");
        li.title = "レギュレーション違反";
      }

      const thumb = createCardThumb(card);
      if (thumb) {
        thumb.classList.add("deck-thumb");
        li.appendChild(thumb);
      }

      const name = document.createElement("div");
      name.className = "card-name deck-card-name";
      name.innerHTML = `${escapeHtml(formatCardName(card.name))}${legalityBadge(card)}`;
      li.appendChild(name);

      const setLabel = formatDeckSetLabel(card);
      if (setLabel) {
        const detail = document.createElement("div");
        detail.className = "card-detail deck-card-set";
        detail.textContent = setLabel;
        li.appendChild(detail);
      }

      const limitText = nameLimitText(card);
      if (limitText) {
        const limit = document.createElement("div");
        limit.className = "card-limit";
        limit.textContent = limitText;
        li.appendChild(limit);
      }

      const controls = document.createElement("div");
      controls.className = "deck-item-controls";

      const orderRow = document.createElement("div");
      orderRow.className = "deck-order-row";

      const leftBtn = document.createElement("button");
      leftBtn.type = "button";
      leftBtn.className = "btn btn-icon btn-order";
      leftBtn.textContent = "←";
      leftBtn.disabled = i === 0;
      leftBtn.title = "左へ";
      leftBtn.addEventListener("click", () => moveDeckEntry(card.card_id, -1));

      const rightBtn = document.createElement("button");
      rightBtn.type = "button";
      rightBtn.className = "btn btn-icon btn-order";
      rightBtn.textContent = "→";
      rightBtn.disabled = i === entries.length - 1;
      rightBtn.title = "右へ";
      rightBtn.addEventListener("click", () => moveDeckEntry(card.card_id, 1));

      orderRow.append(leftBtn, rightBtn);

      const qtyRow = document.createElement("div");
      qtyRow.className = "deck-qty-row";

      const minusBtn = document.createElement("button");
      minusBtn.type = "button";
      minusBtn.className = "btn btn-icon";
      minusBtn.textContent = "−";
      minusBtn.addEventListener("click", () => changeQty(card.card_id, -1));

      const qtyLabel = document.createElement("span");
      qtyLabel.className = "qty-value";
      qtyLabel.textContent = String(qty);

      const plusBtn = document.createElement("button");
      plusBtn.type = "button";
      plusBtn.className = "btn btn-icon";
      plusBtn.textContent = "+";
      const plusCheck = canChangeQty(deck, card, 1);
      plusBtn.disabled = !plusCheck.ok;
      if (!plusCheck.ok) plusBtn.title = plusCheck.reason;
      plusBtn.addEventListener("click", () => changeQty(card.card_id, 1));

      qtyRow.append(minusBtn, qtyLabel, plusBtn);
      controls.append(orderRow, qtyRow);
      li.appendChild(controls);
      list.appendChild(li);
    }

    sectionEl.appendChild(list);
    deckList.appendChild(sectionEl);
  }

  deckEmpty.classList.toggle("hidden", hasCards);

  const total = totalCards(deck);
  deckCount.textContent = `${total} / ${deckSize}`;
  deckCount.classList.toggle("complete", total === deckSize);
  deckCount.classList.toggle("incomplete", total > 0 && total !== deckSize);
  updateMobileDeckBadge(total);

  const ruleWarnings = collectWarnings(deck, deckSize);
  const regWarnings = collectRegulationWarnings(deck, currentFormat, config);
  const warnings = [...ruleWarnings, ...regWarnings];
  deckWarning.textContent = warnings.join(" / ");
  deckWarning.classList.toggle("hidden", warnings.length === 0);

  const hasRegViolation = regWarnings.length > 0;
  const canExport = total === deckSize && !hasRegViolation;
  deckCodeExportBtn.disabled = !canExport;
  if (deckImageExportBtn) {
    deckImageExportBtn.disabled = total === 0;
  }
  if (!canExport) {
    deckExportPanel.classList.add("hidden");
    deckCodeOutput.value = "";
  }
  if (hasRegViolation && total === deckSize) {
    deckCodeExportBtn.title = "レギュレーション違反のカードがあるため作成できません";
  } else if (total !== deckSize) {
    deckCodeExportBtn.title = `${deckSize}枚ちょうどでないと作成できません`;
  } else {
    deckCodeExportBtn.title = "";
  }

  saveDeck();
}

function moveDeckEntry(cardId, delta) {
  const entry = deck.get(cardId);
  if (!entry) return;
  const section = getDeckSection(entry.card);
  deckOrder = moveInSectionOrder(deckOrder, section, cardId, delta);
  renderDeck();
}

async function addCard(card) {
  const config = getRegConfig();
  if (!isLegalInFormat(card, currentFormat, config)) {
    alert(`${getFormatConfig(config, currentFormat).label}では使用できません`);
    return;
  }
  const check = canChangeQty(deck, card, 1);
  if (!check.ok) {
    alert(check.reason);
    return;
  }
  const withMeta = await ensureCardMeta(card);
  const enriched = enrichCard(withMeta, config);
  const current = deck.get(withMeta.card_id);
  const qty = current ? current.qty : 0;
  deck.set(withMeta.card_id, { card: enriched, qty: qty + 1 });
  deckOrder = syncDeckOrder(deckOrder, deck);
  renderDeck();
  if (searchInput.value.trim()) runSearch(searchInput.value);
}

function changeQty(cardId, delta) {
  const entry = deck.get(cardId);
  if (!entry) return;

  const check = canChangeQty(deck, entry.card, delta);
  if (!check.ok) {
    alert(check.reason);
    return;
  }

  const next = entry.qty + delta;
  if (next <= 0) {
    deck.delete(cardId);
  } else {
    entry.qty = next;
  }
  renderDeck();
  if (searchInput.value.trim()) runSearch(searchInput.value);
}

function removeCard(cardId) {
  deck.delete(cardId);
  renderDeck();
  if (searchInput.value.trim()) runSearch(searchInput.value);
}

function clearDeck() {
  if (!deck.size) return;
  if (!confirm("デッキをすべて削除しますか？")) return;
  deck = new Map();
  deckOrder = createEmptyDeckOrder();
  renderDeck();
  if (searchInput.value.trim()) runSearch(searchInput.value);
}

function canExportDeckCode() {
  if (totalCards(deck) !== deckSize) return false;
  return collectRegulationWarnings(deck, currentFormat, getRegConfig()).length === 0;
}

function buildExportPayload() {
  deckOrder = syncDeckOrder(deckOrder, deck);
  const grouped = groupDeckBySection(deck, deckOrder);
  const cards = [];
  for (const section of DECK_SECTIONS) {
    for (const { card, qty } of grouped[section.id]) {
      cards.push({
        card_id: card.card_id,
        qty,
        deck_section: getDeckSection(card),
      });
    }
  }
  return { format: currentFormat, deck_size: deckSize, cards };
}

async function exportDeckListImage() {
  if (!deck.size || !deckImageExportBtn) return;

  deckImageExportBtn.disabled = true;
  deckImageExportBtn.textContent = "作成中...";

  try {
    deckOrder = syncDeckOrder(deckOrder, deck);
    const grouped = groupDeckBySection(deck, deckOrder);
    const entries = [];
    for (const section of DECK_SECTIONS) {
      entries.push(...grouped[section.id]);
    }
    const canvas = await renderDeckListImage(entries);
    const dataUrl = canvas.toDataURL("image/png");
    if (deckImagePreview) deckImagePreview.src = dataUrl;
    if (deckImageDownload) {
      if (deckImageDownload.href?.startsWith("blob:")) {
        URL.revokeObjectURL(deckImageDownload.href);
      }
      deckImageDownload.href = dataUrl;
      deckImageDownload.download = `deck-list-${deckSize}.png`;
    }
    deckImagePanel?.classList.remove("hidden");
  } catch {
    alert("デッキ画像の作成に失敗しました");
  } finally {
    deckImageExportBtn.textContent = "デッキ画像";
    deckImageExportBtn.disabled = totalCards(deck) === 0;
  }
}

function closeDeckImagePanel() {
  deckImagePanel?.classList.add("hidden");
}

async function exportDeckCode() {
  if (!canExportDeckCode()) return;

  deckCodeExportBtn.disabled = true;
  deckCodeExportBtn.textContent = "取得中...";

  try {
    const res = await fetch(appUrl("/api/deck-export"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildExportPayload()),
    });
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      alert(
        res.status === 404
          ? "APIが見つかりません。サーバーを再起動してください（python web/server.py）。"
          : "デッキコードの取得に失敗しました"
      );
      return;
    }

    const data = await res.json();
    if (!res.ok || data.error) {
      alert(data.message || "デッキコードの取得に失敗しました");
      return;
    }

    deckCodeOutput.value = data.code || "";
    deckExportPanel.classList.remove("hidden");
  } catch {
    alert("デッキコードの取得に失敗しました");
  } finally {
    deckCodeExportBtn.textContent = "デッキコード表示";
    deckCodeExportBtn.disabled = !canExportDeckCode();
  }
}

async function copyDeckCode() {
  const code = deckCodeOutput.value.trim();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    deckCodeCopyBtn.textContent = "コピーしました";
    setTimeout(() => {
      deckCodeCopyBtn.textContent = "コピー";
    }, 1500);
  } catch {
    deckCodeOutput.select();
    document.execCommand("copy");
  }
}

async function importDeckFromCode() {
  const code = deckCodeInput.value.trim();
  if (!code) {
    deckCodeStatus.textContent = "デッキコードを入力してください";
    return;
  }

  if (deck.size && !confirm("現在のデッキを置き換えて読み込みますか？")) {
    return;
  }

  deckCodeImportBtn.disabled = true;
  deckCodeStatus.textContent = "読み込み中...";

  try {
    const params = new URLSearchParams({ code });
    const res = await fetch(appUrl(`/api/deck-import?${params}`));
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      deckCodeStatus.textContent =
        res.status === 404
          ? "APIが見つかりません。サーバーを再起動してください（python web/server.py）。"
          : "デッキの読み込みに失敗しました";
      return;
    }

    const data = await res.json();

    if (!res.ok || data.error) {
      deckCodeStatus.textContent = data.message || "デッキの読み込みに失敗しました";
      return;
    }

    const config = getRegConfig();
    deck = new Map();
    deckOrder = createEmptyDeckOrder();

    for (const card of data.cards || []) {
      const cardId = Number(card.card_id);
      const qty = Number(card.qty) || 0;
      if (!cardId || qty <= 0) continue;
      const enriched = enrichCard(card, config);
      deck.set(cardId, { card: enriched, qty });
    }

    await hydrateDeckMeta();
    renderDeck();

    let message = `${data.total}枚のデッキを読み込みました`;
    if (data.missing_ids?.length) {
      message += `（ローカルDBに無いカード: ${data.missing_ids.length}種）`;
    }
    deckCodeStatus.textContent = message;
  } catch {
    deckCodeStatus.textContent = "デッキの読み込みに失敗しました";
  } finally {
    deckCodeImportBtn.disabled = false;
  }
}

async function runSearch(query, options = {}) {
  const q = query.trim();
  if (!q) {
    searchResults.innerHTML = "";
    searchPagination.classList.add("hidden");
    searchStatus.textContent = "カード名を入力してください";
    lastSearchQuery = "";
    searchPage = 1;
    return;
  }

  if (!options.keepPage) {
    searchPage = 1;
  }
  lastSearchQuery = q;

  searchStatus.textContent = "検索中...";
  try {
    const params = new URLSearchParams({
      q,
      limit: String(searchLimit),
      page: String(searchPage),
      format: currentFormat,
    });
    if (currentFormat === "special") {
      params.set("marks", [...specialMarks].join(","));
    }
    if (selectedBanList) {
      params.set("ban_list", selectedBanList);
    }
    const res = await fetch(appUrl(`/api/cards?${params}`));
    if (!res.ok) throw new Error("search failed");
    const data = await res.json();
    searchPage = data.page || searchPage;
    renderSearchResults(data);
  } catch {
    searchStatus.textContent = "検索に失敗しました";
    searchResults.innerHTML = "";
    searchPagination.classList.add("hidden");
  }
}

function updateFormatNote() {
  specialMarksPanel?.classList.toggle("hidden", currentFormat !== "special");
}

function renderSpecialMarks() {
  if (!specialMarksEl) return;
  specialMarksEl.innerHTML = "";
  for (const mark of REGULATION_MARKS) {
    const label = document.createElement("label");
    label.className = "special-mark";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = mark;
    input.checked = specialMarks.has(mark);
    input.addEventListener("change", () => {
      if (input.checked) specialMarks.add(mark);
      else specialMarks.delete(mark);
      saveSpecialMarks();
      updateFormatNote();
      renderDeck();
      if (searchInput.value.trim()) runSearch(searchInput.value);
    });
    label.append(input, document.createTextNode(mark));
    specialMarksEl.appendChild(label);
  }
}

async function loadBanListOptions() {
  if (!banListSelect) return;
  try {
    const res = await fetch(appUrl("/api/ban-lists"));
    if (!res.ok) return;
    const data = await res.json();
    const lists = data.lists || [];
    banListSelect.innerHTML = `<option value="">なし</option>`;
    for (const item of lists) {
      const opt = document.createElement("option");
      opt.value = item.name;
      opt.textContent = `${item.name}（${item.count}）`;
      banListSelect.appendChild(opt);
    }
    if (selectedBanList && [...banListSelect.options].some((o) => o.value === selectedBanList)) {
      banListSelect.value = selectedBanList;
    } else {
      selectedBanList = "";
      banListSelect.value = "";
    }
  } catch {
    // ignore
  }
}

async function applySelectedBanList() {
  customBanIds = new Set();
  customBanNames = new Map();
  if (!selectedBanList) {
    renderDeck();
    if (searchInput.value.trim()) runSearch(searchInput.value);
    return;
  }
  try {
    const params = new URLSearchParams({ name: selectedBanList });
    const res = await fetch(appUrl(`/api/ban-lists?${params}`));
    if (!res.ok) throw new Error("ban list failed");
    const data = await res.json();
    for (const entry of data.entries || []) {
      const id = Number(entry.card_id);
      if (!id) continue;
      customBanIds.add(id);
      if (entry.name) customBanNames.set(id, entry.name);
    }
  } catch {
    customBanIds = new Set();
    customBanNames = new Map();
  }
  renderDeck();
  if (searchInput.value.trim()) runSearch(searchInput.value);
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function loadRegulationConfig() {
  try {
    const res = await fetch(appUrl("/api/regulation-config"));
    if (res.ok) {
      regulationConfig = await res.json();
    }
  } catch {
    regulationConfig = null;
  }

  const mapEmpty =
    !regulationConfig?.setRegulationMap ||
    !Object.keys(regulationConfig.setRegulationMap).length;

  if (mapEmpty) {
    try {
      const mapRes = await fetch(appUrl("/data/set_regulation_map.json"));
      if (mapRes.ok) {
        const map = await mapRes.json();
        regulationConfig = regulationConfig || {};
        regulationConfig.setRegulationMap = map;
      }
    } catch {
      // ignore
    }
  }

  if (!regulationConfig?.formats) {
    try {
      const fmtRes = await fetch(appUrl("/data/regulation_formats.json"));
      if (fmtRes.ok) {
        regulationConfig = regulationConfig || {};
        regulationConfig.formats = await fmtRes.json();
      }
    } catch {
      // ignore
    }
  }

  if (!regulationConfig?.trainerWhitelist) {
    try {
      const wlRes = await fetch(appUrl("/data/standard_trainer_whitelist.json"));
      if (wlRes.ok) {
        const wl = await wlRes.json();
        regulationConfig = regulationConfig || {};
        regulationConfig.trainerWhitelist = wl.names || [];
      }
    } catch {
      // ignore
    }
  }
}

async function loadBannedCards() {
  try {
    const res = await fetch(appUrl("/api/banned-cards"));
    if (res.ok) {
      banData = await res.json();
      return;
    }
  } catch {
    // ignore
  }

  if (regulationConfig?.bannedCards?.entries) {
    banData = regulationConfig.bannedCards;
  }
}

async function hydrateDeckMeta() {
  const tasks = [...deck.values()].map(async (entry) => {
    const withMeta = await ensureCardMeta(entry.card);
    entry.card = enrichCard(withMeta, getRegConfig());
  });
  await Promise.all(tasks);
  deckOrder = syncDeckOrder(deckOrder, deck);
}

async function init() {
  syncMobileLayout();
  mobileMq.addEventListener("change", syncMobileLayout);
  renderSpecialMarks();

  await loadRegulationConfig();
  await loadBannedCards();
  await loadBanListOptions();
  await applySelectedBanList();

  formatSelect.value = "standard";
  currentFormat = "standard";
  if (deckSizeSelect) deckSizeSelect.value = String(deckSize);
  searchLimitSelect.value = String(searchLimit);
  updateFormatNote();
  normalizeDeckCards();
  await hydrateDeckMeta();
  renderDeck();
}

formatSelect.addEventListener("change", () => {
  currentFormat = formatSelect.value;
  if (!VALID_FORMATS.includes(currentFormat)) {
    currentFormat = "standard";
    formatSelect.value = "standard";
  }
  updateFormatNote();
  renderDeck();
  if (searchInput.value.trim()) runSearch(searchInput.value);
});

banListSelect?.addEventListener("change", () => {
  selectedBanList = banListSelect.value || "";
  localStorage.setItem(BAN_LIST_KEY, selectedBanList);
  applySelectedBanList();
});

searchLimitSelect.addEventListener("change", () => {
  const next = Number(searchLimitSelect.value);
  searchLimit = VALID_SEARCH_LIMITS.includes(next) ? next : 50;
  localStorage.setItem(SEARCH_LIMIT_KEY, String(searchLimit));
  if (lastSearchQuery) runSearch(lastSearchQuery);
});

searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(searchInput.value), 250);
});

clearDeckBtn.addEventListener("click", clearDeck);

deckCodeImportBtn.addEventListener("click", () => {
  importDeckFromCode();
});

deckCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    importDeckFromCode();
  }
});

deckCodeExportBtn.addEventListener("click", exportDeckCode);
deckCodeCopyBtn.addEventListener("click", copyDeckCode);
deckImageExportBtn?.addEventListener("click", exportDeckListImage);
deckImageCloseBtn?.addEventListener("click", closeDeckImagePanel);

deckSizeSelect?.addEventListener("change", () => {
  const next = Number(deckSizeSelect.value);
  deckSize = VALID_DECK_SIZES.includes(next) ? next : DECK_SIZE;
  deckSizeSelect.value = String(deckSize);
  saveDeckSize();
  closeDeckImagePanel();
  renderDeck();
});

for (const btn of mobileViewSwitcher?.querySelectorAll(".mobile-view-btn") || []) {
  btn.addEventListener("click", () => setMobileView(btn.dataset.view));
}

init();
