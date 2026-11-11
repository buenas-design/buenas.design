// Photos sent from the computer or the phone, made ready for the site in the browser itself: turned the
// right way up, at most `max` pixels wide and saved as WebP (or JPG, on the browsers that can't make WebP).
// And the picture that shows up when someone shares a post (1200×630 JPG, the cover with the logo in a
// pill in the corner, the same as tools/share-images.py makes).

const load = (src) =>
  new Promise((ok, fail) => {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => ok(im);
    im.onerror = () => fail(new Error(`image: ${src}`));
    im.src = src;
  });

const toBlob = (canvas, type, quality) => new Promise((ok) => canvas.toBlob(ok, type, quality));

// file (from <input type=file>) → { blob, ext, w, h }
// bg: the color behind transparent parts when the photo has to become a JPG (a JPG has no transparency)
export async function prepareImage(file, { max = 2000, quality = 0.86, bg = '#FFFFFF' } = {}) {
  // an animated GIF would stop moving: it goes as it is
  if (file.type === 'image/gif') {
    const im = await load(URL.createObjectURL(file));
    return { blob: file, ext: 'gif', w: im.naturalWidth, h: im.naturalHeight };
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    bitmap = await load(URL.createObjectURL(file));
  }
  const w0 = bitmap.width || bitmap.naturalWidth;
  const h0 = bitmap.height || bitmap.naturalHeight;
  const scale = Math.min(1, max / w0);
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  let blob = await toBlob(canvas, 'image/webp', quality);
  if (blob && blob.type === 'image/webp') return { blob, ext: 'webp', w, h };
  ctx.globalCompositeOperation = 'destination-over';
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  blob = await toBlob(canvas, 'image/jpeg', quality);
  return { blob, ext: 'jpg', w, h };
}

// the cover (a URL the page can draw) → the preview picture for links, as a JPG blob
export async function shareImage(coverUrl, logoUrl, { w = 1200, h = 630, pill = '#FFE8E1', bg = '#FFFFFF' } = {}) {
  const [cover, logo] = await Promise.all([load(coverUrl), logoUrl ? load(logoUrl).catch(() => null) : null]);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = bg || '#FFFFFF';
  ctx.fillRect(0, 0, w, h);
  // the cover fills the frame, cut from the middle
  const s = Math.max(w / cover.naturalWidth, h / cover.naturalHeight);
  const cw = cover.naturalWidth * s;
  const ch = cover.naturalHeight * s;
  ctx.drawImage(cover, (w - cw) / 2, (h - ch) / 2, cw, ch);
  if (logo) {
    const PW = 236, PH = 84, LW = 170;
    const x = 40, y = h - 40 - PH;
    ctx.fillStyle = pill;
    ctx.beginPath();
    ctx.roundRect(x, y, PW, PH, PH / 2);
    ctx.fill();
    const lh = (logo.naturalHeight * LW) / logo.naturalWidth;
    ctx.drawImage(logo, x + (PW - LW) / 2, y + (PH - lh) / 2 + 2, LW, lh);
  }
  return toBlob(canvas, 'image/jpeg', 0.88);
}

export const kb = (bytes, locale) =>
  bytes > 1e6 ? `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(bytes / 1e6)} MB` : `${Math.round(bytes / 1e3)} KB`;
