/**
 * Photos for printed / PDF documents (e.g. picking photos on a GDN).
 * Images come through the attachments function (works whatever the storage CORS is), are turned upright
 * (phone EXIF), shrunk and re-encoded as JPEG so the whole PDF stays under a size limit.
 */
import { sb } from "@jst/data-access";
import type { PrintPhoto } from "./template";

export interface PhotoSource { id: string; caption: string }
interface Loaded { bmp: ImageBitmap; caption: string }

async function fetchImage(id: string): Promise<Blob> {
  const { data, error } = await sb().functions.invoke("attachments", { body: { action: "bytes", id } });
  if (error) throw error;
  if (!(data instanceof Blob)) throw new Error("Not an image");
  return data;
}

/** download + decode every photo (a photo that fails is skipped, the rest still print) */
export async function loadPhotos(sources: PhotoSource[]): Promise<{ loaded: Loaded[]; failed: number }> {
  const out: (Loaded | null)[] = await Promise.all(sources.map(async (s) => {
    try {
      const blob = await fetchImage(s.id);
      const bmp = await createImageBitmap(blob, { imageOrientation: "from-image" });
      return { bmp, caption: s.caption };
    } catch { return null; }
  }));
  const loaded = out.filter((x): x is Loaded => !!x);
  return { loaded, failed: sources.length - loaded.length };
}

const toDataUrl = (b: Blob) => new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(b); });

function encode(bmp: ImageBitmap, side: number, q: number): Promise<{ blob: Blob; w: number; h: number }> {
  const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  return new Promise((res, rej) => c.toBlob((b) => (b ? res({ blob: b, w, h }) : rej(new Error("encode failed"))), "image/jpeg", q));
}

const MAX_SIDE = 1800, MIN_SIDE = 420, Q = 0.7;

/**
 * Each photo as large and sharp as the byte budget allows (budget shared equally).
 * JPEG size grows roughly with the pixel count, so one trial encode tells the right size;
 * a couple of corrections at most — fast even for many photos.
 */
export async function encodePhotos(loaded: Loaded[], budgetBytes: number): Promise<PrintPhoto[]> {
  if (!loaded.length) return [];
  const per = Math.max(35_000, Math.floor(budgetBytes / loaded.length));
  let bytesPerPx = 0; // learned from the photos already done
  const out: PrintPhoto[] = [];
  for (const l of loaded) {
    const big = Math.max(l.bmp.width, l.bmp.height);
    let side = Math.min(MAX_SIDE, big);
    if (bytesPerPx > 0) {
      const ratio = Math.min(l.bmp.width, l.bmp.height) / big;
      side = Math.min(side, Math.sqrt(per * 0.92 / bytesPerPx / ratio));
    }
    side = Math.max(MIN_SIDE, Math.round(side));
    let e = await encode(l.bmp, side, Q);
    for (let i = 0; i < 4 && e.blob.size > per && side > MIN_SIDE; i++) {
      side = Math.max(MIN_SIDE, Math.round(side * Math.sqrt(per * 0.9 / e.blob.size)));
      e = await encode(l.bmp, side, Q);
    }
    if (e.blob.size > per) e = await encode(l.bmp, side, 0.5);   // tiny budget: lower quality as the last step
    bytesPerPx = e.blob.size / (e.w * e.h);
    out.push({ src: await toDataUrl(e.blob), w: e.w, h: e.h, caption: l.caption });
  }
  return out;
}
