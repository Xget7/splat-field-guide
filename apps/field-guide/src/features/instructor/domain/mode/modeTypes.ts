import { InstructorMode } from '../../../../platform/connectivity/networkStatus';

export function isSwitching(mode: InstructorMode): boolean {
  return (
    mode === InstructorMode.switchingToOffline ||
    mode === InstructorMode.switchingToOnline
  );
}
