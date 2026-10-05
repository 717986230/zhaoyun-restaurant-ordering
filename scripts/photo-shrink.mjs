/**
 * Every dish photo the menu ships is 800×600 where it fits, and at most
 * MAX_BYTES: hex-encoded, one photo is one SQL statement in a D1 migration,
 * and D1 refuses a statement over 100 KB. The open dish shows the photo at
 * the full width of a phone, so the size comes first and the quality gives
 * way; only a photo too busy to stay sharp at 800 steps down, never below 640.
 */
import sharp from "sharp";

export const MAX_BYTES = 45_000;

async function encode(buffer, width, quality) {
  return sharp(buffer).rotate().resize(width, (width * 3) / 4, { fit: "cover", position: "attention" }).jpeg({ quality, mozjpeg: true }).toBuffer();
}

export async function shrink(buffer) {
  for (const width of [800, 720, 640]) {
    for (let quality = 80; quality >= 56; quality -= 4) {
      const out = await encode(buffer, width, quality);
      if (out.length <= MAX_BYTES) return out;
    }
  }
  for (let quality = 52; quality >= 32; quality -= 4) {
    const out = await encode(buffer, 640, quality);
    if (out.length <= MAX_BYTES) return out;
  }
  throw new Error(`cannot get the photo under ${MAX_BYTES} bytes`);
}
