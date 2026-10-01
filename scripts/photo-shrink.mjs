/**
 * Every dish photo the menu ships is 480×360 and at most MAX_BYTES: hex-encoded,
 * one photo is one SQL statement in a D1 migration, and D1 refuses a statement
 * over 100 KB.
 */
import sharp from "sharp";

export const MAX_BYTES = 45_000;

export async function shrink(buffer) {
  for (const width of [480, 400]) {
    for (let quality = 78; quality >= 36; quality -= 6) {
      const out = await sharp(buffer).rotate().resize(width, (width * 3) / 4, { fit: "cover", position: "attention" }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (out.length <= MAX_BYTES) return out;
    }
  }
  throw new Error(`cannot get the photo under ${MAX_BYTES} bytes`);
}
