/** "Step 2 of 5" */
export function stepLabel(stepNumber: number, stepCount: number): string {
  return `Step ${stepNumber} of ${stepCount}`;
}

/** Between the fields of a status line: "8 parts, 3 procedures". */
export const READOUT_SEPARATOR = ', ';
