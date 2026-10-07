import { createContext, useContext } from 'react';
import type { InstructorRuntime } from './instructorRuntime';

export const InstructorRuntimeContext = createContext<InstructorRuntime | null>(
  null,
);
const MISSING_RUNTIME = 'App must provide the instructor runtime';
export function useInstructorRuntime(): InstructorRuntime {
  const runtime = useContext(InstructorRuntimeContext);
  if (runtime === null) {
    throw new Error(MISSING_RUNTIME);
  }
  return runtime;
}
