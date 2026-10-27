import { useState } from 'react';
import { useStore } from 'zustand';
import type { AssemblyBatch } from '../domain/assemblySession';
import { createAssemblyStore, type AssemblyStoreState } from './assemblyStore';

/** A fresh assembly tour session for each visit to the screen, with its actions. */
export function useAssemblySession(
  batches: readonly AssemblyBatch[],
): AssemblyStoreState {
  const [store] = useState(() => createAssemblyStore(batches));
  return useStore(store);
}
