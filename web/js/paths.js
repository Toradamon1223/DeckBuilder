/** Base path for subdirectory deployments (e.g. "/DeckBuilder"). Local root = "". */
export function getBasePath() {
  const fromHtml = document.documentElement.dataset.basePath;
  if (typeof fromHtml === "string") return fromHtml.replace(/\/$/, "");
  if (typeof window.__BASE_PATH__ === "string") {
    return window.__BASE_PATH__.replace(/\/$/, "");
  }
  return "";
}

/** Build an app-absolute URL (always starts with /). */
export function appUrl(path) {
  const base = getBasePath();
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${base}${normalized}`;
}
