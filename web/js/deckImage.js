import { cardImageSrc } from "./cardImage.js";
import { appUrl } from "./paths.js";

export const DECK_IMAGE_COLS = 15;
export const DECK_IMAGE_MAX_ROWS = 4;
const CARD_ASPECT = 63 / 88; // Pokémon card width / height

/**
 * Prefer same-origin proxy so canvas is not tainted.
 * @param {object} card
 */
function canvasImageSrc(card) {
  if (card?.card_id) return appUrl(`/api/card-image?card_id=${card.card_id}`);
  return cardImageSrc(card);
}

/**
 * @param {string} src
 * @returns {Promise<HTMLImageElement|null>}
 */
function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} r
 */
function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * Fit card cell size to the available screen area.
 * @param {number} cols
 * @param {number} rows
 * @param {number} maxWidth
 * @param {number} maxHeight
 */
function layoutForScreen(cols, rows, maxWidth, maxHeight) {
  const pad = Math.max(4, Math.round(Math.min(maxWidth, maxHeight) * 0.01));
  const gap = Math.max(2, Math.round(Math.min(maxWidth, maxHeight) * 0.006));

  const innerW = Math.max(1, maxWidth - pad * 2 - gap * (cols - 1));
  const innerH = Math.max(1, maxHeight - pad * 2 - gap * (rows - 1));
  const maxCardW = innerW / cols;
  const maxCardH = innerH / rows;

  let cardW;
  let cardH;
  if (maxCardW / maxCardH > CARD_ASPECT) {
    cardH = maxCardH;
    cardW = cardH * CARD_ASPECT;
  } else {
    cardW = maxCardW;
    cardH = cardW / CARD_ASPECT;
  }

  cardW = Math.max(24, Math.floor(cardW));
  cardH = Math.max(34, Math.floor(cardH));

  const width = pad * 2 + cols * cardW + (cols - 1) * gap;
  const height = pad * 2 + rows * cardH + (rows - 1) * gap;

  return { cardW, cardH, gap, pad, width, height };
}

/**
 * @param {Array<{card: object, qty: number}>} entries
 * @param {{ maxWidth?: number, maxHeight?: number }} [options]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderDeckListImage(entries, options = {}) {
  const limited = entries.slice(0, DECK_IMAGE_COLS * DECK_IMAGE_MAX_ROWS);
  const count = limited.length;
  const cols = Math.min(DECK_IMAGE_COLS, Math.max(1, count));
  const rows = Math.min(DECK_IMAGE_MAX_ROWS, Math.max(1, Math.ceil(count / cols)));

  const maxWidth = Math.max(
    240,
    Math.floor(options.maxWidth || window.innerWidth || window.screen.availWidth)
  );
  const maxHeight = Math.max(
    180,
    Math.floor(options.maxHeight || window.innerHeight || window.screen.availHeight)
  );

  const { cardW, cardH, gap, pad, width, height } = layoutForScreen(
    cols,
    rows,
    maxWidth,
    maxHeight
  );

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.fillStyle = "#0b1220";
  ctx.fillRect(0, 0, width, height);

  const images = await Promise.all(
    limited.map(({ card }) => loadImage(canvasImageSrc(card)))
  );

  const fontSize = Math.max(9, Math.round(cardH * 0.055));
  const badgeH = Math.max(14, Math.round(fontSize * 1.2));
  const badgePadX = Math.max(5, Math.round(fontSize * 0.45));

  limited.forEach(({ qty }, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = pad + col * (cardW + gap);
    const y = pad + row * (cardH + gap);
    const img = images[index];

    ctx.fillStyle = "#1a2433";
    ctx.fillRect(x, y, cardW, cardH);

    if (img) {
      const scale = Math.min(cardW / img.naturalWidth, cardH / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const dx = x + (cardW - dw) / 2;
      const dy = y + (cardH - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    } else {
      ctx.fillStyle = "#6b7a90";
      ctx.font = `${Math.max(9, fontSize - 1)}px sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No Image", x + cardW / 2, y + cardH / 2);
    }

    const label = String(qty);
    ctx.font = `bold ${fontSize}px sans-serif`;
    const textW = ctx.measureText(label).width;
    const badgeW = Math.min(cardW, textW + badgePadX * 2);
    const badgeX = x + (cardW - badgeW) / 2;
    const badgeY = y + cardH - badgeH;

    ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, Math.max(2, Math.round(badgeH / 5)));
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + cardW / 2, badgeY + badgeH / 2);
  });

  return canvas;
}
