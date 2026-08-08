// Everything a scene build needs beyond the document and the time.
//
// Collected into one object because element converters need most of it and
// threading eight parameters through seven converters would be worse.

import type { AnimationDocument } from '../schema/document';
import type { AnimationElement } from '../schema/elements';
import type { AnimationEffect } from '../schema/effects';
import type { Matrix } from '../geometry/matrix';
import type { SnapshotMap } from '../runtime/snapshot';
import type { ElementTree } from '../runtime/tree';
import type { AssetResolver } from '../assets/resolver';
import type { TextMeasurer } from '../text/width';
import type { CodeHighlighter } from './highlight';
import type { SceneDiagnostic } from './nodes';

/** Options a host passes when building a scene. */
export interface SceneOptions {
  /** Resolves `ref` assets. Without it, `ref` images draw a placeholder. */
  readonly assetResolver?: AssetResolver;
  /** Cache shared with `prefetchAssets`, so async resolution is available synchronously. */
  readonly assetCache?: Map<string, string | null>;
  /** Overrides the built-in JavaScript tokenizer for `code` elements. */
  readonly highlighter?: CodeHighlighter;
  /** Real font metrics, when the host can measure. */
  readonly measurer?: TextMeasurer;
  /** Overrides the default proportional font stack. */
  readonly fontFamily?: string;
  /** Overrides the default monospace font stack. */
  readonly monospaceFamily?: string;
  /**
   * Skip the theme-safe color mapping and use authored values verbatim.
   *
   * For static export, where `var(--cloth-fg)` would not resolve to anything.
   */
  readonly rawColors?: boolean;
}

/** Internal build context, assembled once per frame. */
export interface SceneContext {
  readonly doc: AnimationDocument;
  readonly time: number;
  readonly snapshot: SnapshotMap;
  readonly tree: ElementTree;
  readonly elementById: Map<string, AnimationElement>;
  readonly matrices: Map<string, Matrix>;
  readonly visibility: Map<string, boolean>;
  readonly effectsByElement: Map<string, AnimationEffect[]>;
  readonly options: SceneOptions;
  readonly diagnostics: SceneDiagnostic[];
  readonly fontFamily: string;
  readonly monospaceFamily: string;
}

/** Element state at the current time, as a loose record for the converters. */
export type ElementState = Record<string, unknown>;

export function stateOf(ctx: SceneContext, id: string): ElementState | undefined {
  return ctx.snapshot.get(id);
}

export function report(ctx: SceneContext, diagnostic: SceneDiagnostic): void {
  ctx.diagnostics.push(diagnostic);
}
