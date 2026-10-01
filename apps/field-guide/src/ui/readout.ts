// Readouts are fixed width so a list of them lines up like an instrument's.
const READOUT_DIGITS = 2;

/** 7 -> "07" */
export function twoDigits(value: number): string {
  return String(value).padStart(READOUT_DIGITS, '0');
}

/** "Step 02 / 05" for step 2 of 5. */
export function stepLabel(stepNumber: number, stepCount: number): string {
  return `Step ${twoDigits(stepNumber)} / ${twoDigits(stepCount)}`;
}
