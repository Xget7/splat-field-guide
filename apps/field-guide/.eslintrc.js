const SLICES = ['library', 'guide', 'viewer', 'instructor', 'ar', 'bench'];
// index.ts stays free of React and native packages so domain code, tsx and Node can load it;
// views.ts carries the components and hooks that other slices compose.
const PUBLIC_ENTRIES = ['index', 'views'];
const NATIVE = [
  'react',
  'react/**',
  'react-native',
  'react-native-*',
  '@react-native/**',
  '@react-native-*/*',
  '@react-navigation/**',
  '@sbaiahmed1/**',
];
// Exact names, so zustand/vanilla stays available to the pack catalog store.
const REACT_STORE = [
  { name: 'zustand', message: 'React stores live in a slice state folder.' },
];
// Every slice file below the entries sits in a layer folder, so a relative import of another
// slice climbs at least two levels and the slice name follows `../..`. Anchoring on those
// segments keeps folders and files that only share a slice's name, such as the viewer's
// ui/instructor folder (reached as ./instructor or ../instructor) or assets/ar, outside the rule.
const otherSliceInternals = SLICES.flatMap(slice => [
  `**/../../${slice}/*`,
  `**/../../${slice}/*/**`,
  ...PUBLIC_ENTRIES.map(entry => `!**/../../${slice}/${entry}`),
]);
const anySlice = SLICES.flatMap(slice => [`**/${slice}`, `**/${slice}/**`]);
const composition = ['**/app', '**/app/**'];
const presentation = ['**/ui', '**/ui/**', '**/views'];
const sliceFiles = `src/features/{${SLICES.join(',')}}`;

module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      files: [`${sliceFiles}/**/*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: otherSliceInternals,
                message:
                  'Import another slice through its index.ts or views.ts.',
              },
              {
                group: composition,
                message:
                  'Slices cannot import app composition; screens take props and callbacks.',
              },
            ],
          },
        ],
      },
    },
    {
      files: [`${sliceFiles}/domain/**/*.{ts,tsx}`],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            paths: REACT_STORE,
            patterns: [
              {
                group: NATIVE,
                allowTypeImports: true,
                message:
                  'Domain rules run without React or native capabilities.',
              },
              {
                group: [...presentation, '**/state', '**/state/**'],
                message: 'Domain rules cannot import presentation or state.',
              },
            ],
          },
        ],
      },
    },
    {
      files: [`${sliceFiles}/data/**/*.{ts,tsx}`],
      rules: {
        '@typescript-eslint/no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: presentation,
                message: 'Data adapters cannot import presentation.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/features/pack/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: REACT_STORE,
            patterns: [
              {
                group: [
                  ...NATIVE,
                  ...presentation,
                  ...composition,
                  ...anySlice,
                ],
                message:
                  'Pack content stays free of React, native capabilities, presentation and slices.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/ui/**/*.{ts,tsx}', 'src/platform/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/features', '**/features/**', ...composition],
                message:
                  'UI primitives and platform ports cannot import slices, pack content or app composition.',
              },
            ],
          },
        ],
      },
    },
  ],
};
