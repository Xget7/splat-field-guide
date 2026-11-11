module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/*.test.js'],
  transform: {
    '^.+\\.tsx?$': ['babel-jest', { presets: ['module:@react-native/babel-preset'] }],
  },
};
