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
 * Choose cols/rows from image count so cards stay as large as possible on screen.
 * Prefers tidy grids (e.g. 16→8x2, 32→8x4) within max 15x4.
 * @param {number} count
 * @param {number} maxWidth
 * @param {number} maxHeight
 * @returns {{ cols: number, rows: number }}
 */
export function chooseDeckImageGrid(count, maxWidth, maxHeight) {
  const n = Math.max(1, Math.min(count, DECK_IMAGE_COLS * DECK_IMAGE_MAX_ROWS));
  const targetRatio = Math.max(0.2, maxWidth / Math.max(1, maxHeight) / CARD_ASPECT);
  let best = { cols: Math.min(DECK_IMAGE_COLS, n), rows: Math.ceil(n / Math.min(DECK_IMAGE_COLS, n)) };
  let bestScore = -Infinity;

  for (let rows = 1; rows <= Math.min(DECK_IMAGE_MAX_ROWS, n); rows += 1) {
    const cols = Math.ceil(n / rows);
    if (cols > DECK_IMAGE_COLS) continue;

    const layout = layoutForScreen(cols, rows, maxWidth, maxHeight);
    const empty = cols * rows - n;
    const cardArea = layout.cardW * layout.cardH;
    const gridRatio = cols / rows;
    const aspectPenalty = Math.abs(Math.log(gridRatio / targetRatio));
    // Prefer bigger cards, exact-fill grids (16→8x2), and screen-like aspect.
    const score =
      cardArea * (empty === 0 ? 1.2 : 1) - empty * 40 - aspectPenalty * cardArea * 0.35;

    if (score > bestScore) {
      bestScore = score;
      best = { cols, rows };
    }
  }

  return best;
}

/**
 * @param {Array<{card: object, qty: number}>} entries
 * @param {{ maxWidth?: number, maxHeight?: number, pixelRatio?: number }} [options]
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderDeckListImage(entries, options = {}) {
  const limited = entries.slice(0, DECK_IMAGE_COLS * DECK_IMAGE_MAX_ROWS);
  const count = Math.max(1, limited.length);

  const maxWidth = Math.max(
    240,
    Math.floor(options.maxWidth || window.innerWidth || window.screen.availWidth)
  );
  const maxHeight = Math.max(
    180,
    Math.floor(options.maxHeight || window.innerHeight || window.screen.availHeight)
  );

  const { cols, rows } = chooseDeckImageGrid(count, maxWidth, maxHeight);
  const { cardW, cardH, gap, pad, width, height } = layoutForScreen(
    cols,
    rows,
    maxWidth,
    maxHeight
  );

  // Draw sharper than CSS size so downscaling on screen isn't jaggy.
  const dpr = Number(options.pixelRatio) || window.devicePixelRatio || 1;
  let scale = Math.max(2, Math.min(3, dpr));
  // Keep each card at least ~110px wide in the bitmap.
  if (cardW * scale < 110) {
    scale = Math.min(4, 110 / Math.max(1, cardW));
  }
  // Avoid oversized canvases on some browsers.
  const maxSide = 8192;
  if (width * scale > maxSide || height * scale > maxSide) {
    scale = Math.min(scale, maxSide / width, maxSide / height);
  }
  scale = Math.max(1.5, scale);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  canvas.dataset.cssWidth = String(width);
  canvas.dataset.cssHeight = String(height);

  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) {
    ctx.imageSmoothingQuality = "high";
  }

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
      const fit = Math.min(cardW / img.naturalWidth, cardH / img.naturalHeight);
      const dw = img.naturalWidth * fit;
      const dh = img.naturalHeight * fit;
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
