import { appUrl } from "./paths.js";

export function cardImageSrc(card) {
  if (card?.image_url) return card.image_url;
  if (card?.card_id) return appUrl(`/api/card-image?card_id=${card.card_id}`);
  return "";
}

export function cardImageAlt(card) {
  return card?.name || "";
}

export function createCardThumb(card) {
  const src = cardImageSrc(card);
  if (!src) return null;

  const img = document.createElement("img");
  img.className = "card-thumb";
  img.src = src;
  img.alt = cardImageAlt(card);
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("error", () => {
    img.remove();
  });
  return img;
}
