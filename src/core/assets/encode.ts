// Building inline assets from raw bytes.
//
// This is the interface an editor's "attach image" button is built on (Q3): the
// host reads a file however it likes, hands the bytes here, and gets an asset it
// can put straight into the document. No upload endpoint required — the document
// stays self-contained.
//
// Deliberately takes `Uint8Array` rather than `File` or `Blob`: those are DOM
// types, and the core may not touch them (docs/ARCHITECTURE.md §1). Adapters and
// editors do the `file.arrayBuffer()` step.

import type { InlineAsset } from '../schema/assets';
import { bytesToBase64, parseDataUri } from '../text/base64';

/** Warn above this size — the document is JSON, and base64 inflates by ~33%. */
export const INLINE_ASSET_WARN_BYTES = 256 * 1024;

export interface EncodeResult {
  readonly asset: InlineAsset;
  /** Encoded size in bytes, i.e. what the document grows by. */
  readonly encodedBytes: number;
  /** Present when the asset is large enough to be worth a second thought. */
  readonly warning?: string;
}

const IMAGE_MIME_RE = /^image\/[a-z0-9.+-]+$/i;

/**
 * Encode bytes as an inline image asset.
 *
 * Throws on a non-image MIME type rather than producing a document that will fail
 * schema validation later — the caller knows what it passed, the validator would
 * not.
 */
export function encodeImageAsset(bytes: Uint8Array, mime: string): EncodeResult {
  if (!IMAGE_MIME_RE.test(mime)) {
    throw new Error(`inline assets must be image/* — received "${mime}"`);
  }

  const data = bytesToBase64(bytes);
  const asset: InlineAsset = { kind: 'inline', mime: mime.toLowerCase(), data };
  const encodedBytes = data.length;

  if (encodedBytes > INLINE_ASSET_WARN_BYTES) {
    return {
      asset,
      encodedBytes,
      warning:
        `inline asset is ${Math.round(encodedBytes / 1024)}KB once encoded; ` +
        'consider an external URL or a host-resolved ref for anything this large',
    };
  }
  return { asset, encodedBytes };
}

/**
 * Convert a `data:` URI into an inline asset.
 *
 * Convenience for hosts that already hold a data URI — a canvas `toDataURL()`, a
 * pasted clipboard image. Returns null for a non-base64 or non-image URI.
 */
export function inlineAssetFromDataUri(uri: string): InlineAsset | null {
  const parsed = parseDataUri(uri);
  if (!parsed || !parsed.base64) return null;
  if (!IMAGE_MIME_RE.test(parsed.mime)) return null;
  return { kind: 'inline', mime: parsed.mime.toLowerCase(), data: parsed.data };
}

/** Sniff an image MIME type from magic bytes, for hosts without a filename. */
export function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  const [b0, b1, b2, b3] = [bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!];

  if (b0 === 0x89 && b1 === 0x50 && b2 === 0x4e && b3 === 0x47) return 'image/png';
  if (b0 === 0xff && b1 === 0xd8 && b2 === 0xff) return 'image/jpeg';
  if (b0 === 0x47 && b1 === 0x49 && b2 === 0x46) return 'image/gif';
  if (b0 === 0x42 && b1 === 0x4d) return 'image/bmp';

  // RIFF....WEBP
  if (b0 === 0x52 && b1 === 0x49 && b2 === 0x46 && b3 === 0x46 && bytes.length >= 12) {
    if (bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
      return 'image/webp';
    }
  }

  // SVG has no magic number; look for a root element in the leading bytes.
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256)));
  if (/<\s*svg[\s>]/i.test(head)) return 'image/svg+xml';

  return null;
}
