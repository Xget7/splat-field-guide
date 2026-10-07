const composition = ['**/screens/**', '**/app/**', '**/App'];
const native = [
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
      files: ['src/features/{pack,guide}/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  ...native,
                  ...composition,
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
                group: composition,
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
                  ...composition,
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
