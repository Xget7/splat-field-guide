const { ESLint } = require('eslint');

const eslint = new ESLint({ cwd: require('process').cwd() });

async function violations(code: string, filePath: string) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message: { ruleId: string | null }) =>
    message.ruleId?.includes('restricted-imports'),
  );
}

test.each([
  "export { Screen } from './ui/Screen';",
  "export { useState } from 'react';",
  "export { View } from 'react-native';",
])('non-React public entries reject %s', async code => {
  expect(
    await violations(code, 'src/features/guide/index.ts'),
  ).not.toHaveLength(0);
});

test.each([
  [
    "import { reduce } from '../../guide';",
    'src/features/viewer/domain/example.ts',
  ],
  [
    "import type { ViewStyle } from 'react-native';",
    'src/features/viewer/domain/example.ts',
  ],
  ["export { reduce } from './domain/session';", 'src/features/guide/index.ts'],
  [
    "import { createStore } from 'zustand/vanilla';",
    'src/features/pack/example.ts',
  ],
])('allowed dependency %s', async (code, filePath) => {
  expect(await violations(code, filePath)).toHaveLength(0);
});

test.each([
  [
    "import { reduce } from '../../guide/domain/session';",
    'src/features/viewer/domain/example.ts',
  ],
  [
    "import { View } from 'react-native';",
    'src/features/viewer/domain/example.ts',
  ],
  [
    "import { ViewerScreen } from '../../viewer/views';",
    'src/features/viewer/domain/example.ts',
  ],
  ["import App from '../../../app/App';", 'src/features/viewer/ui/example.tsx'],
  ["import { reduce } from '../features/guide';", 'src/platform/example.ts'],
  ["import { reduce } from '../guide';", 'src/features/pack/example.ts'],
])('forbidden dependency %s', async (code, filePath) => {
  expect(await violations(code, filePath)).not.toHaveLength(0);
});
