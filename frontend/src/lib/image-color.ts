/**
 * Client-side image helpers for project backgrounds:
 *  - downscaleImageToDataUrl: shrink an uploaded file to a storable data URL
 *  - extractAccentColor: derive a representative accent hex from an image
 *
 * Palette extraction runs on a tiny canvas: pixels are quantised into coarse
 * RGB buckets, then the most frequent *vibrant* bucket wins (falling back to a
 * plain average if nothing is colourful enough). Cross-origin URLs that block
 * canvas reads resolve to '' so callers can fall back to the default accent.
 */

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

/** Downscale an uploaded image file to a JPEG/PNG data URL (default max 1280px). */
export async function downscaleImageToDataUrl(
  file: File,
  maxDim = 1280,
  quality = 0.82,
): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.readAsDataURL(file);
  });
  const img = await loadImage(dataUrl);
  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
  if (scale >= 1) return dataUrl; // already small enough — keep original
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  // Keep PNG transparency; otherwise JPEG for size.
  const isPng = file.type === 'image/png';
  return canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', quality);
}

/** Downscale an uploaded image and return both a Blob (for upload) and a data URL (for preview/accent). */
export async function downscaleImageToBlob(
  file: File,
  maxDim = 1280,
  quality = 0.82,
): Promise<{ blob: Blob; dataUrl: string }> {
  const dataUrl = await downscaleImageToDataUrl(file, maxDim, quality);
  const blob = await (await fetch(dataUrl)).blob();
  return { blob, dataUrl };
}

/** Derive a representative accent hex from an image src; '' if it can't be read. */
export async function extractAccentColor(src: string): Promise<string> {
  try {
    const img = await loadImage(src);
    const size = 48;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, size, size);
    const { data } = ctx.getImageData(0, 0, size, size);

    const buckets = new Map<string, { count: number; r: number; g: number; b: number; score: number }>();
    let avgR = 0, avgG = 0, avgB = 0, n = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      if (a < 200) continue; // skip transparent
      avgR += r; avgG += g; avgB += b; n++;

      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lum = (max + min) / 2;
      const sat = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255) || 1);
      // Ignore near-black / near-white / washed-out pixels for the vibrant pick.
      if (lum < 28 || lum > 235 || sat < 0.18) continue;

      const key = `${r >> 4}-${g >> 4}-${b >> 4}`; // 16-level quantisation
      const cur = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0, score: 0 };
      cur.count++; cur.r += r; cur.g += g; cur.b += b;
      cur.score += sat; // prefer more saturated buckets
      buckets.set(key, cur);
    }

    if (buckets.size > 0) {
      let best: { count: number; r: number; g: number; b: number; score: number } | null = null;
      for (const v of buckets.values()) {
        if (!best || v.score > best.score) best = v;
      }
      if (best) return toHex(best.r / best.count, best.g / best.count, best.b / best.count);
    }

    if (n > 0) return toHex(avgR / n, avgG / n, avgB / n);
    return '';
  } catch {
    return ''; // tainted canvas / load failure → caller uses default accent
  }
}
