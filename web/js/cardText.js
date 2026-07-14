export function decodeHtml(text) {
  if (!text || !text.includes("&")) return text;
  const el = document.createElement("textarea");
  el.innerHTML = text;
  return el.value;
}

export function formatCardName(name) {
  return decodeHtml(name || "");
}
