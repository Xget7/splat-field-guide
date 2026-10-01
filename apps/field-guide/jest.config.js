const path = require('path');

module.exports = {
  preset: '@react-native/jest-preset',
  roots: ['<rootDir>/../../tests/field-guide'],
  testMatch: ['**/*.test.[jt]s?(x)'],
  modulePaths: ['<rootDir>/node_modules'],
  setupFiles: ['<rootDir>/../../tests/field-guide/setup.js'],
  // External tests use the app's Babel preset and native dependency versions.
  transform: {
    '^.+\\.(js|ts|tsx)$': [
      'babel-jest',
      { configFile: path.join(__dirname, 'babel.config.js') },
    ],
  },
  // Picks Reanimated's and Worklets' web code paths, which run without a UI thread.
  resolver: 'react-native-reanimated/jest/resolver',
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native(-[a-z-]+)?|@react-native(-community)?|@react-navigation|@react-native-async-storage)/)',
  ],
};
