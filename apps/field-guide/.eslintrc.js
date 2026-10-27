// The warn rules describe the feature slice layout the next change moves the
// tree to; they become errors once the tree matches it. Until then the three
// error rules at the end keep guarding today's layout. ESLint replaces a rule's
// options when a later override matches the same file, so those error rules
// come last to win over the warnings rather than be downgraded by them.
const SLICE_SEVERITY = 'warn';
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
// A relative import of another slice's internals always names that slice; imports inside a slice never do.
const otherSliceInternals = SLICES.flatMap(slice => [
  `**/${slice}/*`,
  `**/${slice}/*/**`,
  ...PUBLIC_ENTRIES.map(entry => `!**/${slice}/${entry}`),
]);
const anySlice = SLICES.flatMap(slice => [`**/${slice}`, `**/${slice}/**`]);
const composition = ['**/app', '**/app/**'];
const presentation = ['**/ui', '**/ui/**', '**/views'];
const sliceFiles = `src/features/{${SLICES.join(',')}}`;

// Today's layout, guarded by the error rules until the tree moves.
const currentComposition = ['**/screens/**', '**/app/**', '**/App'];
const currentNative = [
  'react',
  'react/**',
  'react-native',
  'react-native-*',
  '@react-native/**',
  '@react-native-*/*',
  '@react-navigation/**',
];

module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      files: [`${sliceFiles}/**/*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': [
          SLICE_SEVERITY,
          {
            patterns: [
              {
                group: otherSliceInternals,
                message:
                  'Import another slice through its index.ts or views.ts.',
              },
              {
                group: composition,
                message: 'Slices cannot import app composition.',
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
          SLICE_SEVERITY,
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
          SLICE_SEVERITY,
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
          SLICE_SEVERITY,
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
          SLICE_SEVERITY,
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
    {
      files: ['src/features/{pack,guide}/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  ...currentNative,
                  ...currentComposition,
                  '**/instructor/**',
                  '**/viewport/**',
                  '**/ui/**',
                ],
                message:
                  'Pack and guide rules stay independent of React, native capabilities and presentation.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/features/{instructor,viewport}/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: currentComposition,
                message:
                  'Instructor and viewport cannot import screens or app composition.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/ui/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  ...currentComposition,
                  '**/pack/**',
                  '**/guide/**',
                  '**/instructor/**',
                  '**/viewport/**',
                ],
                message:
                  'UI primitives cannot import business code or app composition.',
              },
            ],
          },
        ],
      },
    },
  ],
};
