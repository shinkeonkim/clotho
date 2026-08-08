// Asset tests. All new — legacy had no asset concept.

import { describe, expect, it } from 'bun:test';
import { assetMapSchema, type AssetMap } from '../schema/assets';
import { missingAssetIds, prefetchAssets, resolveAsset, type AssetResolver } from './resolver';
import {
  INLINE_ASSET_WARN_BYTES,
  encodeImageAsset,
  inlineAssetFromDataUri,
  sniffImageMime,
} from './encode';
import { toBase64 } from '../text/base64';

const assets: AssetMap = assetMapSchema.parse({
  logo: { kind: 'inline', mime: 'image/png', data: 'AQID' },
  hero: { kind: 'external', url: 'https://example.com/hero.png' },
  chart: { kind: 'ref', key: 'post-42/chart' },
});

describe('resolveAsset', () => {
  it('builds a data URI for an inline asset without any host help', () => {
    expect(resolveAsset('logo', assets)).toEqual({
      status: 'resolved',
      href: 'data:image/png;base64,AQID',
    });
  });

  it('passes an external URL through', () => {
    expect(resolveAsset('hero', assets)).toEqual({
      status: 'resolved',
      href: 'https://example.com/hero.png',
    });
  });

  it('reports an unregistered id', () => {
    const result = resolveAsset('nope', assets);
    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('no asset registered');
  });

  it('explains that a ref needs a resolver', () => {
    const result = resolveAsset('chart', assets);
    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('no AssetResolver');
  });

  it('resolves a ref through a synchronous resolver and receives both key and id', () => {
    const seen: unknown[] = [];
    const resolver: AssetResolver = {
      resolve(ref) {
        seen.push(ref);
        return `/cdn/${ref.key}`;
      },
    };
    expect(resolveAsset('chart', assets, resolver)).toEqual({
      status: 'resolved',
      href: '/cdn/post-42/chart',
    });
    expect(seen).toEqual([{ key: 'post-42/chart', assetId: 'chart' }]);
  });

  it('treats a resolver null as unresolved, not as an error', () => {
    const result = resolveAsset('chart', assets, { resolve: () => null });
    expect(result.status).toBe('unresolved');
    expect(result.reason).toContain('post-42/chart');
  });

  // Scene building is synchronous by design, so an async resolver has to be
  // primed with prefetchAssets first.
  it('reports pending for an async resolver rather than blocking', () => {
    const result = resolveAsset('chart', assets, { resolve: async () => '/late' });
    expect(result).toEqual({ status: 'pending' });
  });

  it('caches a synchronous resolution', () => {
    let calls = 0;
    const resolver: AssetResolver = {
      resolve: () => {
        calls += 1;
        return '/once';
      },
    };
    const cache = new Map<string, string | null>();
    resolveAsset('chart', assets, resolver, cache);
    resolveAsset('chart', assets, resolver, cache);
    expect(calls).toBe(1);
  });
});

describe('prefetchAssets', () => {
  it('primes the cache so later synchronous resolution succeeds', async () => {
    const cache = await prefetchAssets(assets, { resolve: async (ref) => `/cdn/${ref.key}` });
    expect(resolveAsset('chart', assets, undefined, cache)).toEqual({
      status: 'resolved',
      href: '/cdn/post-42/chart',
    });
  });

  it('only asks about refs', async () => {
    const keys: string[] = [];
    await prefetchAssets(assets, {
      resolve: (ref) => {
        keys.push(ref.key);
        return null;
      },
    });
    expect(keys).toEqual(['post-42/chart']);
  });

  it('isolates a throwing resolver to the one asset', async () => {
    const many = assetMapSchema.parse({
      good: { kind: 'ref', key: 'ok' },
      bad: { kind: 'ref', key: 'boom' },
    });
    const cache = await prefetchAssets(many, {
      resolve: (ref) => {
        if (ref.key === 'boom') throw new Error('network');
        return '/ok';
      },
    });
    expect(resolveAsset('good', many, undefined, cache).status).toBe('resolved');
    expect(resolveAsset('bad', many, undefined, cache).status).toBe('unresolved');
  });

  it('does not re-resolve what the cache already holds', async () => {
    let calls = 0;
    const cache = new Map<string, string | null>([['post-42/chart', '/cached']]);
    await prefetchAssets(
      assets,
      {
        resolve: () => {
          calls += 1;
          return '/fresh';
        },
      },
      cache,
    );
    expect(calls).toBe(0);
  });
});

describe('missingAssetIds', () => {
  it('lists referenced ids that are not registered, without duplicates', () => {
    expect(missingAssetIds(assets, ['logo', 'ghost', 'ghost', 'hero'])).toEqual(['ghost']);
  });

  it('returns nothing when every reference resolves', () => {
    expect(missingAssetIds(assets, ['logo', 'hero', 'chart'])).toEqual([]);
  });
});

describe('encodeImageAsset', () => {
  it('encodes bytes into a schema-valid inline asset', () => {
    const { asset, encodedBytes } = encodeImageAsset(new Uint8Array([1, 2, 3]), 'image/png');
    expect(asset).toEqual({ kind: 'inline', mime: 'image/png', data: 'AQID' });
    expect(encodedBytes).toBe(4);
    expect(assetMapSchema.safeParse({ a: asset }).success).toBe(true);
  });

  it('normalizes the mime type case', () => {
    expect(encodeImageAsset(new Uint8Array([1]), 'IMAGE/PNG').asset.mime).toBe('image/png');
  });

  it('refuses a non-image type up front rather than failing validation later', () => {
    expect(() => encodeImageAsset(new Uint8Array([1]), 'text/html')).toThrow(/must be image/);
  });

  it('warns above the size threshold', () => {
    const big = new Uint8Array(INLINE_ASSET_WARN_BYTES);
    const result = encodeImageAsset(big, 'image/png');
    expect(result.warning).toContain('KB');
    expect(result.asset.data.length).toBeGreaterThan(INLINE_ASSET_WARN_BYTES);
  });

  it('stays quiet for a small asset', () => {
    expect(encodeImageAsset(new Uint8Array([1, 2, 3]), 'image/png').warning).toBeUndefined();
  });

  it('survives a round trip through the resolver', () => {
    const { asset } = encodeImageAsset(new TextEncoder().encode('<svg/>'), 'image/svg+xml');
    const resolved = resolveAsset('x', { x: asset });
    expect(resolved.href).toBe(`data:image/svg+xml;base64,${toBase64('<svg/>')}`);
  });
});

describe('inlineAssetFromDataUri', () => {
  it('accepts a base64 image data URI', () => {
    expect(inlineAssetFromDataUri('data:image/png;base64,AQID')).toEqual({
      kind: 'inline',
      mime: 'image/png',
      data: 'AQID',
    });
  });

  it('rejects a non-base64 or non-image URI', () => {
    expect(inlineAssetFromDataUri('data:image/png,raw')).toBeNull();
    expect(inlineAssetFromDataUri('data:text/html;base64,AQID')).toBeNull();
    expect(inlineAssetFromDataUri('https://example.com/a.png')).toBeNull();
  });
});

describe('sniffImageMime', () => {
  it('recognizes common formats by magic bytes', () => {
    expect(sniffImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]))).toBe('image/png');
    expect(sniffImageMime(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageMime(new Uint8Array([0x47, 0x49, 0x46, 0x38]))).toBe('image/gif');
    expect(sniffImageMime(new Uint8Array([0x42, 0x4d, 0, 0]))).toBe('image/bmp');
  });

  it('recognizes webp through its RIFF container', () => {
    const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(sniffImageMime(webp)).toBe('image/webp');
    // RIFF without the WEBP tag is some other RIFF file.
    expect(
      sniffImageMime(new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0, 0, 0, 0])),
    ).toBeNull();
  });

  it('recognizes svg by its root element, having no magic number', () => {
    expect(sniffImageMime(new TextEncoder().encode('<svg xmlns="...">'))).toBe('image/svg+xml');
    expect(sniffImageMime(new TextEncoder().encode('<?xml version="1.0"?><svg >'))).toBe(
      'image/svg+xml',
    );
  });

  it('returns null for unknown or truncated input', () => {
    expect(sniffImageMime(new Uint8Array([1, 2]))).toBeNull();
    expect(sniffImageMime(new TextEncoder().encode('just text here'))).toBeNull();
  });
});
