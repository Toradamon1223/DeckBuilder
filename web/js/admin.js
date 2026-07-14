import { buildBanIndex, enrichCard } from "./regulation.js";
import { formatCardName } from "./cardText.js";
import { createCardThumb } from "./cardImage.js";
import { appUrl } from "./paths.js";

const FORMAT_LABELS = {
  standard: "スタンダード",
  extra: "エクストラ",
};

const loginPanel = document.getElementById("login-panel");
const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const loginSubmitBtn = document.getElementById("login-submit");
const adminPassword = document.getElementById("admin-password");
const adminContent = document.getElementById("admin-content");
const logoutBtn = document.getElementById("logout-btn");

const formatSelect = document.getElementById("admin-format");
const searchInput = document.getElementById("admin-search");
const searchStatus = document.getElementById("admin-search-status");
const searchResults = document.getElementById("admin-search-results");
const banList = document.getElementById("ban-list");
const banEmpty = document.getElementById("ban-empty");
const banCount = document.getElementById("ban-count");
const banNote = document.getElementById("ban-note");
const saveStatus = document.getElementById("save-status");
const banFileSelect = document.getElementById("ban-file-select");
const banFileNewName = document.getElementById("ban-file-new-name");
const banFileCreateBtn = document.getElementById("ban-file-create");
const banFileSaveBtn = document.getElementById("ban-file-save");
const banFileDeleteBtn = document.getElementById("ban-file-delete");
const banFileText = document.getElementById("ban-file-text");
const fileSaveStatus = document.getElementById("file-save-status");

/** @type {{ entries: object[], updated: string|null }} */
let banData = { entries: [], updated: null };
/** @type {object|null} */
let regulationConfig = null;
let searchTimer = null;
let isAuthenticated = false;

const FETCH_TIMEOUT_MS = 8000;
const bootAbort = new AbortController();
let loginInFlight = false;

async function fetchJson(url, options = {}, externalSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const abortAll = () => controller.abort();
  externalSignal?.addEventListener("abort", abortAll, { once: true });

  try {
    const res = await fetch(url, {
      ...options,
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { res, data };
  } catch (error) {
    if (externalSignal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("サーバー応答がタイムアウトしました。");
    }
    throw new Error("サーバーに接続できませんでした。");
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", abortAll);
  }
}

function setLoginPending(pending) {
  if (loginSubmitBtn) loginSubmitBtn.disabled = pending;
  if (adminPassword) adminPassword.disabled = pending;
}

function emptyRegulationConfig() {
  return {
    setRegulationMap: {},
    trainerWhitelist: [],
    formatLegal: { standard: {}, extra: {} },
  };
}

function getRegConfig() {
  const banIndex = buildBanIndex(banData.entries);
  return {
    ...(regulationConfig || {}),
    setRegulationMap: regulationConfig?.setRegulationMap || {},
    bannedByFormat: banIndex.byFormat,
    banDetails: banIndex.details,
  };
}

function formatCardDetail(card) {
  const enriched = enrichCard(card, getRegConfig());
  const parts = [];
  if (enriched.regulation_mark) parts.push(`レギュ ${enriched.regulation_mark}`);
  if (card.set_code) parts.push(card.set_code);
  if (card.number_label) parts.push(card.number_label);
  return parts.join(" · ");
}

function formatLabels(formats) {
  return (formats || []).map((f) => FORMAT_LABELS[f] || f).join("・");
}

function isBannedForFormat(cardId, format) {
  return banData.entries.some(
    (e) => Number(e.card_id) === Number(cardId) && e.formats.includes(format)
  );
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function showLoginView({ configured, message }) {
  loginPanel.classList.remove("hidden");
  adminContent.classList.add("hidden");
  logoutBtn.classList.add("hidden");
  loginStatus.textContent = message;
  loginForm.classList.toggle("hidden", !configured);
}

function normalizeBanData(data) {
  if (!data || typeof data !== "object") {
    return { entries: [], updated: null };
  }
  return {
    entries: Array.isArray(data.entries) ? data.entries : [],
    updated: data.updated ?? null,
  };
}

function showAdminView() {
  loginPanel.classList.add("hidden");
  adminContent.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
}

async function checkSession() {
  const { res, data } = await fetchJson(appUrl("/api/admin/session"), {}, bootAbort.signal);
  if (!res.ok) throw new Error("session check failed");
  return data;
}

async function loadBans() {
  const { res, data } = await fetchJson(appUrl("/api/banned-cards"));
  if (!res.ok) throw new Error("禁止リストの読み込みに失敗しました");
  banData = normalizeBanData(data);
}

async function enterAdmin() {
  showAdminView();
  saveStatus.textContent = "読み込み中...";
  regulationConfig = emptyRegulationConfig();
  await loadBans();
  renderBanList();
  saveStatus.textContent = banData.updated
    ? `最終更新: ${new Date(banData.updated).toLocaleString("ja-JP")}`
    : "";
  await loadBanFiles();
}

async function init() {
  try {
    const session = await checkSession();
    if (!session.configured) {
      showLoginView({
        configured: false,
        message: "この機能は現在利用できません。",
      });
      return;
    }
    if (session.authenticated) {
      isAuthenticated = true;
      await enterAdmin();
      return;
    }
    showLoginView({
      configured: true,
      message: "管理者パスワードを入力してください。",
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return;
    }
    if (bootAbort.signal.aborted) return;
    showLoginView({
      configured: true,
      message:
        error instanceof Error
          ? error.message
          : "認証状態の確認に失敗しました。",
    });
  }
}

if (loginForm) {
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (loginInFlight) return;

    loginInFlight = true;
    bootAbort.abort();
    setLoginPending(true);
    loginStatus.textContent = "ログイン中...";

    try {
      const password = adminPassword.value.trim();
      const { res, data } = await fetchJson(appUrl("/api/admin/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        throw new Error(data.message || "パスワードが正しくありません。");
      }

      adminPassword.value = "";
      isAuthenticated = true;
      showAdminView();
      await enterAdmin();
    } catch (error) {
      isAuthenticated = false;
      showLoginView({
        configured: true,
        message:
          error instanceof Error ? error.message : "ログインに失敗しました",
      });
    } finally {
      loginInFlight = false;
      setLoginPending(false);
    }
  });
}

async function logout() {
  await fetch(appUrl("/api/admin/logout"), {
    method: "POST",
    credentials: "same-origin",
  }).catch(() => {});
  isAuthenticated = false;
  adminPassword.value = "";
  showLoginView({ configured: true, message: "ログアウトしました" });
}

function renderBanList() {
  const format = formatSelect.value;
  const filtered = banData.entries.filter((e) => e.formats.includes(format));
  banList.innerHTML = "";
  banEmpty.classList.toggle("hidden", filtered.length > 0);
  banCount.textContent = `${filtered.length}件`;

  for (const entry of filtered) {
    const li = document.createElement("li");
    li.className = "card-item";

    const meta = document.createElement("div");
    meta.className = "card-meta";
    const note = entry.note ? `<div class="card-limit">${escapeHtml(entry.note)}</div>` : "";
    const otherFormats = entry.formats.filter((f) => f !== format);
    const also =
      otherFormats.length > 0
        ? `<span class="badge badge-whitelist">${escapeHtml(formatLabels(otherFormats))}でも禁止</span>`
        : "";
    meta.innerHTML = `
      <div class="card-name">${escapeHtml(formatCardName(entry.name))}${also}</div>
      <div class="card-detail">${escapeHtml(
        [entry.set_code, entry.number_label].filter(Boolean).join(" · ")
      )}</div>
      ${note}
    `;

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "btn btn-ghost";
    removeBtn.textContent = "解除";
    removeBtn.addEventListener("click", () => removeBan(entry.card_id, format));

    const body = document.createElement("div");
    body.className = "card-item-body";
    body.append(meta, removeBtn);

    const thumb = createCardThumb({ card_id: entry.card_id, name: entry.name });
    if (thumb) li.appendChild(thumb);
    li.append(body);
    banList.appendChild(li);
  }
}

async function persistBans() {
  saveStatus.textContent = "保存中...";
  try {
    const res = await fetch(appUrl("/api/banned-cards"), {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entries: banData.entries }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) {
      isAuthenticated = false;
      showLoginView({ configured: true, message: "セッションが切れました。再ログインしてください。" });
      return;
    }
    if (!res.ok) throw new Error(data.message || "save failed");
    banData = data;
    saveStatus.textContent = banData.updated
      ? `保存済（${new Date(banData.updated).toLocaleString("ja-JP")}）`
      : "保存済";
    renderBanList();
  } catch {
    saveStatus.textContent = "保存に失敗しました";
  }
}

function addBan(card) {
  const format = formatSelect.value;
  if (isBannedForFormat(card.card_id, format)) return;

  const note = banNote.value.trim();
  const existing = banData.entries.find((e) => Number(e.card_id) === Number(card.card_id));

  if (existing) {
    if (!existing.formats.includes(format)) {
      existing.formats = [...existing.formats, format].sort();
    }
    if (note) existing.note = note;
  } else {
    banData.entries.push({
      card_id: card.card_id,
      name: card.name,
      set_code: card.set_code || "",
      number_label: card.number_label || "",
      formats: [format],
      note,
    });
  }

  banData.entries.sort((a, b) =>
    a.name.localeCompare(b.name, "ja") || a.set_code.localeCompare(b.set_code)
  );
  renderBanList();
  if (searchInput.value.trim()) runSearch(searchInput.value);
  persistBans();
}

function removeBan(cardId, format) {
  banData.entries = banData.entries
    .map((entry) => {
      if (Number(entry.card_id) !== Number(cardId)) return entry;
      const formats = entry.formats.filter((f) => f !== format);
      if (!formats.length) return null;
      return { ...entry, formats };
    })
    .filter(Boolean);

  renderBanList();
  if (searchInput.value.trim()) runSearch(searchInput.value);
  persistBans();
}

function renderSearchResults(cards) {
  searchResults.innerHTML = "";
  const format = formatSelect.value;

  if (!cards.length) {
    searchStatus.textContent = "該当するカードがありません";
    return;
  }
  searchStatus.textContent = `${cards.length}件表示`;

  for (const card of cards) {
    const li = document.createElement("li");
    li.className = "card-item";

    const meta = document.createElement("div");
    meta.className = "card-meta";
    meta.innerHTML = `
      <div class="card-name">${escapeHtml(formatCardName(card.name))}</div>
      <div class="card-detail">${escapeHtml(formatCardDetail(card))}</div>
    `;

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn-primary";
    const banned = isBannedForFormat(card.card_id, format);
    addBtn.textContent = banned ? "登録済" : "禁止に追加";
    addBtn.disabled = banned;
    addBtn.addEventListener("click", () => addBan(card));

    const body = document.createElement("div");
    body.className = "card-item-body";
    body.append(meta, addBtn);

    const thumb = createCardThumb(card);
    if (thumb) li.appendChild(thumb);
    li.append(body);
    searchResults.appendChild(li);
  }
}

async function runSearch(query) {
  const q = query.trim();
  if (!q) {
    searchResults.innerHTML = "";
    searchStatus.textContent = "カード名を入力して検索";
    return;
  }

  searchStatus.textContent = "検索中...";
  try {
    const { res, data } = await fetchJson(
      appUrl(`/api/cards?q=${encodeURIComponent(q)}&limit=50&format=all`)
    );
    if (!res.ok) throw new Error("search failed");
    const cards = Array.isArray(data) ? data : data.cards || [];
    renderSearchResults(cards);
  } catch {
    searchStatus.textContent = "検索に失敗しました";
    searchResults.innerHTML = "";
  }
}

logoutBtn.addEventListener("click", () => {
  logout();
});

formatSelect.addEventListener("change", () => {
  if (!isAuthenticated) return;
  renderBanList();
  if (searchInput.value.trim()) runSearch(searchInput.value);
});

searchInput.addEventListener("input", () => {
  if (!isAuthenticated) return;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch(searchInput.value), 250);
});

async function loadBanFiles() {
  if (!banFileSelect) return;
  const { res, data } = await fetchJson(appUrl("/api/ban-lists"));
  if (!res.ok) return;
  const lists = data.lists || [];
  const previous = banFileSelect.value;
  banFileSelect.innerHTML = "";
  for (const item of lists) {
    const opt = document.createElement("option");
    opt.value = item.name;
    opt.textContent = `${item.name}（${item.count}）`;
    banFileSelect.appendChild(opt);
  }
  if (!lists.length) {
    banFileText.value = "";
    fileSaveStatus.textContent = "リストがありません。新規作成してください。";
    return;
  }
  if (previous && lists.some((item) => item.name === previous)) {
    banFileSelect.value = previous;
  }
  await loadSelectedBanFile();
}

async function loadSelectedBanFile() {
  const name = banFileSelect.value;
  if (!name) return;
  const params = new URLSearchParams({ name });
  const { res, data } = await fetchJson(appUrl(`/api/ban-lists?${params}`));
  if (!res.ok) {
    fileSaveStatus.textContent = data.message || "読み込み失敗";
    return;
  }
  banFileText.value = data.text || "";
  fileSaveStatus.textContent = `${data.count || 0}件`;
}

banFileSelect?.addEventListener("change", () => {
  if (!isAuthenticated) return;
  loadSelectedBanFile();
});

banFileSaveBtn?.addEventListener("click", async () => {
  if (!isAuthenticated) return;
  const name = banFileSelect.value;
  if (!name) {
    fileSaveStatus.textContent = "リストを選択してください";
    return;
  }
  fileSaveStatus.textContent = "保存中...";
  const { res, data } = await fetchJson(appUrl("/api/ban-lists"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, text: banFileText.value }),
  });
  if (!res.ok) {
    fileSaveStatus.textContent = data.message || "保存失敗";
    return;
  }
  banFileText.value = data.text || banFileText.value;
  fileSaveStatus.textContent = `保存しました（${data.count || 0}件）`;
  await loadBanFiles();
});

banFileCreateBtn?.addEventListener("click", async () => {
  if (!isAuthenticated) return;
  const name = (banFileNewName.value || "").trim();
  if (!name) {
    fileSaveStatus.textContent = "新規名を入力してください";
    return;
  }
  fileSaveStatus.textContent = "作成中...";
  const { res, data } = await fetchJson(appUrl("/api/ban-lists"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name,
      text: "# new ban list\n# card_id\\tname\n",
    }),
  });
  if (!res.ok) {
    fileSaveStatus.textContent = data.message || "作成失敗";
    return;
  }
  banFileNewName.value = "";
  await loadBanFiles();
  banFileSelect.value = name;
  await loadSelectedBanFile();
  fileSaveStatus.textContent = `「${name}」を作成しました`;
});

banFileDeleteBtn?.addEventListener("click", async () => {
  if (!isAuthenticated) return;
  const name = banFileSelect.value;
  if (!name) return;
  if (!confirm(`禁止リスト「${name}」を削除しますか？`)) return;
  const { res, data } = await fetchJson(appUrl("/api/ban-lists/delete"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    fileSaveStatus.textContent = data.message || "削除失敗";
    return;
  }
  await loadBanFiles();
  fileSaveStatus.textContent = `「${name}」を削除しました`;
});

init();
