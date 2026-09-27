// Image hosting for feed posts. The Swop app composer uploads straight to
// Swop's Cloudinary account with the unsigned `swopapp` preset
// (desktop-app lib/SendCloudinaryImage.ts) and posts the resulting URL; the
// backend only accepts images hosted there. This does the same upload, so an
// assistant can hand us any https image or an inline base64 one.

const CLOUD = 'bayshore';
const PRESET = 'swopapp';
const HOSTED = /^https:\/\/res\.cloudinary\.com\/bayshore\/(image|video)\/upload\/[^\s?#]+$/;
const DATA_URI = /^data:(image\/(png|jpe?g|gif|webp));base64,([A-Za-z0-9+/=\s]+)$/;
export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

export const isSwopHosted = (url: string) => HOSTED.test(url);

// Accepts an https URL, a data:image/...;base64 URI, or bare base64 (PNG/JPEG/
// GIF/WebP, sniffed from the magic bytes). Returns the Swop-hosted URL; an
// image already hosted by Swop is returned unchanged, so re-sending the URLs a
// preview returned never re-uploads.
export async function hostImage(input: string): Promise<string> {
  const src = input.trim();
  if (isSwopHosted(src)) return src;

  let file: string;
  if (/^https:\/\//i.test(src)) {
    file = src; // Cloudinary fetches remote URLs itself
  } else {
    const m = DATA_URI.exec(src);
    const b64 = (m ? m[3] : src).replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]+=*$/.test(b64)) {
      throw new Error('Each image must be an https URL, a data:image/...;base64 URI, or base64-encoded image bytes.');
    }
    const bytes = Buffer.from(b64, 'base64');
    if (bytes.length > MAX_IMAGE_BYTES) {
      throw new Error(`Image is ${(bytes.length / 1048576).toFixed(1)} MB; the limit is 3 MB. Pass an https URL instead.`);
    }
    const mime = m ? m[1] : sniffMime(bytes);
    if (!mime) throw new Error('Unrecognised image data. Send PNG, JPEG, GIF or WebP.');
    file = `data:${mime};base64,${b64}`;
  }

  const form = new FormData();
  form.append('file', file);
  form.append('upload_preset', PRESET);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUD}/image/upload`, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json().catch(() => ({}))) as { secure_url?: string; error?: { message?: string } };
  if (!res.ok || !json.secure_url) {
    throw new Error(`Image upload failed: ${json.error?.message ?? `HTTP ${res.status}`}`);
  }
  return json.secure_url;
}

function sniffMime(b: Buffer): string | null {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString('latin1'))) return 'image/gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}
