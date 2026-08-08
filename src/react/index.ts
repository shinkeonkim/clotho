// React adapter: scene mapper, player bindings, and components.
//
// react/react-dom are optional peers; importing this subpath requires them.

export * from './attrs';
export * from './scene';
export * from './hooks';
export { AnimationPlayer, AnimationStage, default } from './AnimationPlayer';
export type { AnimationPlayerProps, AnimationStageProps } from './AnimationPlayer';
export { defaultStrings, koreanStrings, CLASS } from '../dom/strings';
export type { Strings } from '../dom/strings';
