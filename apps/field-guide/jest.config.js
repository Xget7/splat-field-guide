const path = require('path');

module.exports = {
  moduleNameMapper: {
    'instructor\\.config\\.json$': '<rootDir>/instructor.config.example.json',
    '^@tests/(.*)$': '<rootDir>/../../tests/$1',
  },
  preset: '@react-native/jest-preset',
  // Slices keep their tests in a tests folder under src, and the root tests
  // folder keeps the shared fakes and setup, so both roots are searched.
  roots: ['<rootDir>/src', '<rootDir>/../../tests'],
  testMatch: ['**/tests/**/*.test.[jt]s?(x)'],
  modulePaths: ['<rootDir>/node_modules'],
  setupFiles: ['<rootDir>/../../tests/setup.js'],
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
