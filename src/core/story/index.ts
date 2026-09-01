import { z } from 'zod';
import { animationDocumentSchema, type AnimationDocument } from '../schema/document';
import { dataValueSchema, type DataValue } from '../schema/data';

export interface StoryNode {
  readonly id: string;
  readonly title: string;
  readonly document: AnimationDocument;
}
export interface StoryEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string;
  readonly label: string;
  readonly checkpointId?: string;
  readonly equals?: DataValue;
}
export interface StoryManifest {
  readonly storyVersion: 1;
  readonly id: string;
  readonly title: string;
  readonly initialNode: string;
  readonly nodes: readonly StoryNode[];
  readonly edges: readonly StoryEdge[];
}

const storyNodeSchema = z.object({
  id: z.string().min(1),
  title: z.string().default(''),
  document: animationDocumentSchema,
});

const storyEdgeSchema = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().default(''),
  checkpointId: z.string().min(1).optional(),
  equals: dataValueSchema.optional(),
});

export const storyManifestSchema: z.ZodType<StoryManifest> = z.object({
  storyVersion: z.literal(1),
  id: z.string().min(1),
  title: z.string().default(''),
  initialNode: z.string().min(1),
  nodes: z.array(storyNodeSchema).min(1),
  edges: z.array(storyEdgeSchema).default([]),
}) as z.ZodType<StoryManifest>;

export interface StoryFinding {
  readonly code:
    | 'duplicate-node'
    | 'duplicate-edge'
    | 'missing-node'
    | 'missing-checkpoint'
    | 'unreachable-node';
  readonly path: string;
  readonly message: string;
}

export function validateStory(manifest: StoryManifest): StoryFinding[] {
  const findings: StoryFinding[] = [];
  const nodes = new Map<string, StoryNode>();
  const edges = new Set<string>();
  manifest.nodes.forEach((node, index) => {
    if (nodes.has(node.id))
      findings.push({
        code: 'duplicate-node',
        path: `nodes.${index}.id`,
        message: `node "${node.id}" is duplicated`,
      });
    nodes.set(node.id, node);
  });
  if (!nodes.has(manifest.initialNode))
    findings.push({
      code: 'missing-node',
      path: 'initialNode',
      message: `initial node "${manifest.initialNode}" does not exist`,
    });
  manifest.edges.forEach((edge, index) => {
    if (edges.has(edge.id))
      findings.push({
        code: 'duplicate-edge',
        path: `edges.${index}.id`,
        message: `edge "${edge.id}" is duplicated`,
      });
    edges.add(edge.id);
    const from = nodes.get(edge.from);
    if (!from)
      findings.push({
        code: 'missing-node',
        path: `edges.${index}.from`,
        message: `source node "${edge.from}" does not exist`,
      });
    if (!nodes.has(edge.to))
      findings.push({
        code: 'missing-node',
        path: `edges.${index}.to`,
        message: `target node "${edge.to}" does not exist`,
      });
    if (
      edge.checkpointId &&
      from &&
      !from.document.checkpoints.some(({ id }) => id === edge.checkpointId)
    )
      findings.push({
        code: 'missing-checkpoint',
        path: `edges.${index}.checkpointId`,
        message: `checkpoint "${edge.checkpointId}" does not exist in node "${edge.from}"`,
      });
  });
  const reachable = new Set([manifest.initialNode]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of manifest.edges)
      if (reachable.has(edge.from) && !reachable.has(edge.to)) {
        reachable.add(edge.to);
        changed = true;
      }
  }
  manifest.nodes.forEach((node, index) => {
    if (!reachable.has(node.id))
      findings.push({
        code: 'unreachable-node',
        path: `nodes.${index}.id`,
        message: `node "${node.id}" cannot be reached from the initial node`,
      });
  });
  return findings;
}

export function defineStory(input: unknown): StoryManifest {
  const manifest = storyManifestSchema.parse(input);
  const errors = validateStory(manifest).filter(({ code }) => code !== 'unreachable-node');
  if (errors.length > 0) throw new Error(errors.map(({ message }) => message).join('; '));
  return manifest;
}

export interface StoryState {
  readonly nodeId: string;
  readonly document: AnimationDocument;
  readonly history: readonly string[];
  readonly answers: Readonly<Record<string, DataValue>>;
}

export interface StorySession {
  getState(): StoryState;
  answer(checkpointId: string, value: DataValue): StoryState;
  choose(edgeId: string): StoryState;
  back(): StoryState;
  reset(nodeId?: string): StoryState;
}

export function createStorySession(
  manifest: StoryManifest,
  initialNode = manifest.initialNode,
): StorySession {
  const nodes = new Map(manifest.nodes.map((node) => [node.id, node]));
  if (!nodes.has(initialNode)) throw new Error(`story node "${initialNode}" does not exist`);
  let nodeId = initialNode;
  let history: string[] = [];
  let answers: Record<string, DataValue> = {};
  const state = (): StoryState => ({
    nodeId,
    document: nodes.get(nodeId)!.document,
    history: [...history],
    answers: structuredClone(answers),
  });
  const move = (edge: StoryEdge): StoryState => {
    history = [...history, nodeId];
    nodeId = edge.to;
    return state();
  };
  return {
    getState: state,
    answer(checkpointId, value) {
      answers = { ...answers, [checkpointId]: structuredClone(value) };
      const edge = manifest.edges.find(
        (candidate) =>
          candidate.from === nodeId &&
          candidate.checkpointId === checkpointId &&
          (candidate.equals === undefined ||
            JSON.stringify(candidate.equals) === JSON.stringify(value)),
      );
      return edge ? move(edge) : state();
    },
    choose(edgeId) {
      const edge = manifest.edges.find(
        (candidate) => candidate.id === edgeId && candidate.from === nodeId,
      );
      if (!edge) throw new Error(`edge "${edgeId}" is not available from node "${nodeId}"`);
      return move(edge);
    },
    back() {
      const previous = history.at(-1);
      if (previous) {
        nodeId = previous;
        history = history.slice(0, -1);
      }
      return state();
    },
    reset(next = manifest.initialNode) {
      if (!nodes.has(next)) throw new Error(`story node "${next}" does not exist`);
      nodeId = next;
      history = [];
      answers = {};
      return state();
    },
  };
}

export function storyDeepLink(storyId: string, nodeId: string): string {
  return `story=${encodeURIComponent(storyId)}&node=${encodeURIComponent(nodeId)}`;
}
