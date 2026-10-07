const path = require('path');

module.exports = {
  moduleNameMapper: {
    'instructor\\.config\\.json$': '<rootDir>/instructor.config.example.json',
  },
  preset: '@react-native/jest-preset',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.[jt]s?(x)'],
  modulePaths: ['<rootDir>/node_modules'],
  setupFiles: ['<rootDir>/src/testing/setup.js'],
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
