export const LearnMode = {
  instructor: 'instructor',
  selfGuided: 'selfGuided',
} as const;
export type LearnMode = (typeof LearnMode)[keyof typeof LearnMode];
