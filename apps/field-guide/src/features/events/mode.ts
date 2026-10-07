import { InstructorMode } from './types';

export function isSwitching(mode: InstructorMode): boolean {
  return (
    mode === InstructorMode.switchingToOffline ||
    mode === InstructorMode.switchingToOnline
  );
}
