const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const appRoot = __dirname;
const splatLibrary = path.resolve(appRoot, '../../packages/react-native-splat');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * The library is linked with `file:`, so Metro follows it outside the app root.
 * Its own node_modules (installed for typecheck and lint) must not shadow the
 * app's copies of react, react-native and the Nitro runtime.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [splatLibrary],
  resolver: {
    nodeModulesPaths: [path.join(appRoot, 'node_modules')],
    blockList: [new RegExp(`${splatLibrary}/(node_modules|engine)/.*`)],
  },
};

module.exports = mergeConfig(getDefaultConfig(appRoot), config);
