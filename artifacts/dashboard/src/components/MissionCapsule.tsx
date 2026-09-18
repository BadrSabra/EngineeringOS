import {
  ExecutionProjectionPanel,
  type ExecutionProjectionPanelProps,
} from './ExecutionProjectionPanel';

export type MissionCapsuleProps = ExecutionProjectionPanelProps;

/**
 * Shared Mission Capsule surface. ExecutionProjectionPanel remains the
 * compatibility name for existing callers while every page converges on one
 * projection-backed presentation.
 */
export function MissionCapsule(props: MissionCapsuleProps) {
  return <ExecutionProjectionPanel {...props} />;
}