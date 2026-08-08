// legacy v3/v4 → clotho v1 migration (docs/SCHEMA-V1.md §4).
//
// The mapping is small because v1 deliberately changed little. Four rewrites:
//   version: 3|4      → clothoVersion: 1
//   image.src         → assets registry entry + assetId
//   group.childIds    → parentId on each child
//   everything else   → verbatim
//
// The guiding rule is **preserve what was rendered**, not what was declared. That
// distinction matters for groups: legacy's renderer had no `group` branch, so a
// group drew nothing and its listed children rendered independently at absolute
// coordinates. v1 children are positioned relative to their group, so a faithful
// migration must neutralize the group's own transform — otherwise every child in a
// group with a non-zero origin would jump on first render. Where that happens the
// migration says so rather than silently moving artwork.

import { parseDataUri } from '../text/base64';
import type { Asset } from '../schema/assets';

export type MigrationNoteCode =
  | 'group-transform-dropped'
  | 'group-child-missing'
  | 'image-src-inlined'
  | 'image-src-external'
  | 'image-src-missing'
  | 'unknown-version';

export interface MigrationNote {
  readonly code: MigrationNoteCode;
  readonly message: string;
  /** Element or asset the note concerns, when applicable. */
  readonly elementId?: string;
}

export interface MigrationResult {
  /** Migrated document, ready for `parseDocument`. */
  readonly document: Record<string, unknown>;
  readonly notes: MigrationNote[];
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asArray(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

/**
 * Migrate one legacy document.
 *
 * Takes and returns plain JSON rather than typed documents: the input has not been
 * validated (that is the point of migrating it), and the output is handed to
 * `parseDocument` which applies defaults and reports issues properly.
 */
export function migrateLegacyDocument(input: unknown): MigrationResult {
  if (!isObject(input)) {
    throw new TypeError('legacy document must be an object');
  }

  const notes: MigrationNote[] = [];
  const { version, ...rest } = input;

  if (version !== 3 && version !== 4 && version !== undefined) {
    notes.push({
      code: 'unknown-version',
      message: `unexpected legacy version ${JSON.stringify(version)}; migrating as if it were 4`,
    });
  }

  const elements = asArray(rest.elements).map((el) => ({ ...el }));
  const assets: Record<string, Asset> = isObject(rest.assets)
    ? ({ ...rest.assets } as Record<string, Asset>)
    : {};

  applyGroupParents(elements, notes);
  convertImageSources(elements, assets, notes);

  // Named `migrated` rather than `document`: a local binding by that name shadows
  // the DOM global, which makes the core-purity check unable to tell an ordinary
  // property write from real DOM access.
  const migrated: Json = {
    clothoVersion: 1,
    ...rest,
    elements,
  };
  if (Object.keys(assets).length > 0) migrated.assets = assets;

  return { document: migrated, notes };
}

/**
 * Turn `group.childIds` into `parentId` on the referenced children.
 *
 * A child claimed by two groups keeps the first claim; legacy would have rendered
 * it once regardless, and picking deterministically beats leaving it to object key
 * order.
 */
function applyGroupParents(elements: Json[], notes: MigrationNote[]): void {
  const byId = new Map<string, Json>();
  for (const el of elements) {
    const id = el.id;
    if (typeof id === 'string') byId.set(id, el);
  }

  for (const el of elements) {
    if (el.type !== 'group') continue;
    const groupId = typeof el.id === 'string' ? el.id : undefined;
    const childIds = Array.isArray(el.childIds) ? el.childIds : [];
    delete el.childIds;

    // legacy never applied a group transform, so keeping one here would move the
    // children that used to render at absolute coordinates.
    const hasTransform =
      (typeof el.x === 'number' && el.x !== 0) ||
      (typeof el.y === 'number' && el.y !== 0) ||
      (typeof el.rotation === 'number' && el.rotation !== 0);
    if (hasTransform) {
      notes.push({
        code: 'group-transform-dropped',
        elementId: groupId,
        message:
          `group "${groupId}" declared x/y/rotation, which the legacy renderer ignored; ` +
          'reset to identity so its children stay where they were drawn',
      });
    }
    el.x = 0;
    el.y = 0;
    el.rotation = 0;

    if (groupId === undefined) continue;
    for (const childId of childIds) {
      if (typeof childId !== 'string') continue;
      const child = byId.get(childId);
      if (!child) {
        notes.push({
          code: 'group-child-missing',
          elementId: groupId,
          message: `group "${groupId}" lists child "${childId}", which is not in the document`,
        });
        continue;
      }
      if (child.parentId === undefined) child.parentId = groupId;
    }
  }
}

/**
 * Move `image.src` into the asset registry.
 *
 * A `data:` URI becomes an `inline` asset (the document was already carrying the
 * bytes); anything else becomes `external`. An image with no usable `src` gets a
 * placeholder asset id so the element survives migration and the validator can
 * name the problem, instead of the element vanishing.
 */
function convertImageSources(
  elements: Json[],
  assets: Record<string, Asset>,
  notes: MigrationNote[],
): void {
  for (const el of elements) {
    if (el.type !== 'image') continue;
    const elementId = typeof el.id === 'string' ? el.id : 'image';
    const src = el.src;
    delete el.src;

    if (el.assetId !== undefined) continue; // already migrated

    const assetId = uniqueAssetId(`img-${elementId}`, assets);

    if (typeof src !== 'string' || src.trim() === '') {
      el.assetId = assetId;
      notes.push({
        code: 'image-src-missing',
        elementId,
        message: `image "${elementId}" had no src; asset "${assetId}" is unregistered and will fail validation`,
      });
      continue;
    }

    const dataUri = parseDataUri(src);
    if (dataUri && dataUri.base64 && /^image\//i.test(dataUri.mime)) {
      assets[assetId] = { kind: 'inline', mime: dataUri.mime.toLowerCase(), data: dataUri.data };
      notes.push({
        code: 'image-src-inlined',
        elementId,
        message: `image "${elementId}" src was a data URI; stored as inline asset "${assetId}"`,
      });
    } else {
      assets[assetId] = { kind: 'external', url: src };
      notes.push({
        code: 'image-src-external',
        elementId,
        message: `image "${elementId}" src moved to external asset "${assetId}"`,
      });
    }
    el.assetId = assetId;
  }
}

function uniqueAssetId(base: string, assets: Record<string, unknown>): string {
  if (assets[base] === undefined) return base;
  let n = 2;
  while (assets[`${base}-${n}`] !== undefined) n += 1;
  return `${base}-${n}`;
}

/** True when the value carries a legacy envelope and needs migrating. */
export function needsMigration(value: unknown): boolean {
  if (!isObject(value)) return false;
  if (value.clothoVersion !== undefined) return false;
  return value.version === 3 || value.version === 4;
}
