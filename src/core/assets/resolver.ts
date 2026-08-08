// Turning asset declarations into something an `<image href>` can use.
//
// Three kinds, three paths (docs/SCHEMA-V1.md §2.3):
//   inline   → a data URI built from the stored base64, no host involvement
//   external → the URL verbatim
//   ref      → handed to a host-supplied resolver
//
// The `ref` path is the reason this is an interface rather than a function: a blog
// with a CDN, an app with signed URLs, and an editor with an in-memory upload
// buffer all need different lookups, and none of them belong in this package.

import type { Asset, AssetMap } from '../schema/assets';
import { dataUriFromBase64 } from '../text/base64';

export interface AssetRef {
  /** The `key` from a `ref` asset. */
  readonly key: string;
  /** The id under which the asset is registered in the document. */
  readonly assetId: string;
}

export interface AssetResolver {
  /**
   * Return a URL or data URI for `ref`, or null when it cannot be resolved.
   *
   * May be async. Until it settles, the renderer draws a placeholder rather than
   * collapsing the element's box, so resolution never causes layout shift.
   */
  resolve(ref: AssetRef): string | null | Promise<string | null>;
}

export type ResolvedAssetStatus = 'resolved' | 'pending' | 'unresolved';

export interface ResolvedAsset {
  readonly status: ResolvedAssetStatus;
  /** Usable in `href` when status is 'resolved'. */
  readonly href?: string;
  /** Why resolution failed, for validators and editors. */
  readonly reason?: string;
}

const PENDING: ResolvedAsset = { status: 'pending' };

/**
 * Resolve one asset synchronously.
 *
 * A `ref` whose resolver returns a promise reports `pending`: the scene builder is
 * synchronous by design (a frame is a pure function of time), so async lookups have
 * to be primed beforehand — see `prefetchAssets`.
 */
export function resolveAsset(
  assetId: string,
  assets: AssetMap,
  resolver?: AssetResolver,
  cache?: Map<string, string | null>,
): ResolvedAsset {
  const asset = assets[assetId];
  if (!asset) {
    return { status: 'unresolved', reason: `no asset registered under id "${assetId}"` };
  }
  return resolveDeclaredAsset(assetId, asset, resolver, cache);
}

function resolveDeclaredAsset(
  assetId: string,
  asset: Asset,
  resolver?: AssetResolver,
  cache?: Map<string, string | null>,
): ResolvedAsset {
  if (asset.kind === 'inline') {
    return { status: 'resolved', href: dataUriFromBase64(asset.mime, asset.data) };
  }
  if (asset.kind === 'external') {
    return { status: 'resolved', href: asset.url };
  }

  if (cache?.has(asset.key)) {
    const cached = cache.get(asset.key)!;
    if (cached === null) {
      return { status: 'unresolved', reason: `resolver returned no URL for ref "${asset.key}"` };
    }
    return { status: 'resolved', href: cached };
  }

  if (!resolver) {
    return {
      status: 'unresolved',
      reason: `asset "${assetId}" is a ref ("${asset.key}") but no AssetResolver was provided`,
    };
  }

  const result = resolver.resolve({ key: asset.key, assetId });
  if (result instanceof Promise) return PENDING;
  if (result === null) {
    return { status: 'unresolved', reason: `resolver returned no URL for ref "${asset.key}"` };
  }
  cache?.set(asset.key, result);
  return { status: 'resolved', href: result };
}

/**
 * Resolve every `ref` asset up front, filling `cache` so later synchronous scene
 * builds find them.
 *
 * One rejected or missing ref does not sink the others: each is cached
 * individually, so a broken image degrades to a placeholder in its own box.
 */
export async function prefetchAssets(
  assets: AssetMap,
  resolver: AssetResolver,
  cache: Map<string, string | null> = new Map(),
): Promise<Map<string, string | null>> {
  const refs = Object.entries(assets).filter(
    (entry): entry is [string, Extract<Asset, { kind: 'ref' }>] => entry[1].kind === 'ref',
  );

  await Promise.all(
    refs.map(async ([assetId, asset]) => {
      if (cache.has(asset.key)) return;
      try {
        cache.set(asset.key, (await resolver.resolve({ key: asset.key, assetId })) ?? null);
      } catch {
        cache.set(asset.key, null);
      }
    }),
  );

  return cache;
}

/** Asset ids referenced by `image` elements but absent from the registry. */
export function missingAssetIds(assets: AssetMap, referencedIds: readonly string[]): string[] {
  return [...new Set(referencedIds)].filter((id) => assets[id] === undefined);
}
