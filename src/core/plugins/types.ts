import type { AnimationDocument } from '../schema';
import type { Finding } from '../validate/validate';

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PluginCapability = 'parse' | 'normalize' | 'compile' | 'validate' | 'export' | 'editor';

export interface PluginRequirement {
  id: string;
  /** Informational until the experimental API adopts a version-range implementation. */
  version?: string;
}

export interface PluginEditorContribution {
  panels?: string[];
  toolbarItems?: string[];
  inspectors?: string[];
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  /** Compatible Clotho range, recorded for hosts and registries. */
  clotho: string;
  capabilities: PluginCapability[];
  requires?: PluginRequirement[];
  before?: string[];
  after?: string[];
  editor?: PluginEditorContribution;
}

export interface PluginContext {
  /** Stable seed supplied by the host. Plugins must not read wall-clock time. */
  seed: string;
  pluginId: string;
}

export interface PluginParseResult {
  handled: boolean;
  value?: JsonValue;
}

export interface PluginExportArtifact {
  filename: string;
  mime: string;
  data: string | Uint8Array;
}

export interface ClothoPlugin {
  manifest: PluginManifest;
  parse?(input: JsonValue, context: PluginContext): PluginParseResult;
  normalize?(input: JsonValue, context: PluginContext): JsonValue;
  compile?(input: JsonValue, context: PluginContext): JsonValue;
  validate?(document: AnimationDocument, context: PluginContext): Finding[];
  export?(
    format: string,
    document: AnimationDocument,
    context: PluginContext,
  ): PluginExportArtifact[] | undefined;
}

export interface PluginTraceEntry {
  pluginId: string;
  stage: Exclude<PluginCapability, 'editor'>;
}

export interface PluginPipelineOptions {
  seed?: string;
  /** Runs the pipeline twice and rejects output that changes between runs. */
  verifyDeterminism?: boolean;
}

export interface PluginPipelineSuccess {
  ok: true;
  document: AnimationDocument;
  findings: Finding[];
  trace: PluginTraceEntry[];
}

export interface PluginPipelineFailure {
  ok: false;
  error: PluginError;
  trace: PluginTraceEntry[];
}

export type PluginPipelineResult = PluginPipelineSuccess | PluginPipelineFailure;

export type PluginErrorCode =
  | 'invalid-manifest'
  | 'duplicate-plugin'
  | 'missing-plugin'
  | 'dependency-cycle'
  | 'capability-mismatch'
  | 'invalid-json'
  | 'parse-conflict'
  | 'invalid-document'
  | 'non-deterministic'
  | 'plugin-failure'
  | 'unsupported-export';

export class PluginError extends Error {
  constructor(
    public readonly code: PluginErrorCode,
    message: string,
    public readonly pluginId?: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'PluginError';
  }
}
