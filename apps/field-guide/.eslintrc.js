module.exports = {
  root: true,
  extends: '@react-native',
  overrides: [
    {
      files: ['src/domain/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: ['react', 'react-native'],
            patterns: [
              {
                group: [
                  'react-native-*',
                  '@react-native/**',
                  '@react-native-*/*',
                  '**/app/**',
                  '**/features/**',
                  '**/modules/**',
                  '**/shared/**',
                ],
                message:
                  'Domain rules must stay independent of React, native capabilities and presentation.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/modules/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/app/**', '**/features/**'],
                message:
                  'Reusable modules cannot depend on app composition or feature screens.',
              },
            ],
          },
        ],
      },
    },
    {
      files: [
        'src/modules/instructor/domain/**/*.ts',
        'src/modules/instructor/application/**/*.ts',
        'src/modules/instructor/voice/model/**/*.ts',
        'src/modules/progress/model/**/*.ts',
      ],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            paths: ['react', 'react-native'],
            patterns: [
              {
                group: [
                  'react-native-*',
                  '@react-native/**',
                  '@react-native-*/*',
                  '**/data/**',
                  '**/hooks/**',
                  '**/components/**',
                  '**/app/**',
                  '**/features/**',
                ],
                message:
                  'Pure module logic receives capabilities through interfaces; native adapters belong in data.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/features/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['**/app/**'],
                message:
                  'Features use shared navigation contracts and cannot import app composition.',
              },
            ],
          },
        ],
      },
    },
    {
      files: ['src/shared/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: [
                  '**/app/**',
                  '**/features/**',
                  '**/modules/**',
                  '**/domain/**',
                ],
                message:
                  'Shared UI, hooks and navigation contracts must stay independent of business modules.',
              },
            ],
          },
        ],
      },
    },
  ],
};
