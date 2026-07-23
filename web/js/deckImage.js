import { cardImageSrc } from "./cardImage.js";
import { appUrl } from "./paths.js";

const COLS = 15;
const MAX_ROWS = 4;
const CARD_W = 140;
const CARD_H = 196;
const GAP = 8;
const PAD = 12;

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
 * @param {Array<{card: object, qty: number}>} entries
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function renderDeckListImage(entries) {
  const limited = entries.slice(0, COLS * MAX_ROWS);
  const count = limited.length;
  const cols = Math.min(COLS, Math.max(1, count));
  const rows = Math.min(MAX_ROWS, Math.max(1, Math.ceil(count / cols)));

  const width = PAD * 2 + cols * CARD_W + (cols - 1) * GAP;
  const height = PAD * 2 + rows * CARD_H + (rows - 1) * GAP;

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

  limited.forEach(({ qty }, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = PAD + col * (CARD_W + GAP);
    const y = PAD + row * (CARD_H + GAP);
    const img = images[index];

    ctx.fillStyle = "#1a2433";
    ctx.fillRect(x, y, CARD_W, CARD_H);

    if (img) {
      const scale = Math.min(CARD_W / img.naturalWidth, CARD_H / img.naturalHeight);
      const dw = img.naturalWidth * scale;
      const dh = img.naturalHeight * scale;
      const dx = x + (CARD_W - dw) / 2;
      const dy = y + (CARD_H - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
    } else {
      ctx.fillStyle = "#6b7a90";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No Image", x + CARD_W / 2, y + CARD_H / 2);
    }

    const label = String(qty);
    ctx.font = "bold 18px sans-serif";
    const textW = ctx.measureText(label).width;
    const badgePadX = 10;
    const badgePadY = 4;
    const badgeW = textW + badgePadX * 2;
    const badgeH = 26;
    const badgeX = x + (CARD_W - badgeW) / 2;
    const badgeY = y + CARD_H - badgeH - 8;

    ctx.fillStyle = "rgba(0, 0, 0, 0.88)";
    roundRect(ctx, badgeX, badgeY, badgeW, badgeH, 6);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + CARD_W / 2, badgeY + badgeH / 2 + 1);
  });

  return canvas;
}
