const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const appRoot = __dirname;
const splatLibrary = path.resolve(appRoot, '../../packages/react-native-splat');
const onDeviceLibrary = path.resolve(
  appRoot,
  '../../packages/react-native-on-device',
);
const bundledPack = path.resolve(
  appRoot,
  '../../data/pack/gol-trend-engine-bay/1',
);

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
  watchFolders: [splatLibrary, onDeviceLibrary, bundledPack],
  resolver: {
    nodeModulesPaths: [path.join(appRoot, 'node_modules')],
    // Only the pack's manifest is imported; its cloud and labels ship as app resources.
    blockList: [
      new RegExp(
        `${appRoot}/(ios/(Pods|build)|android/(build|app/build|app/.cxx|.gradle)|vendor)/.*`,
      ),
      new RegExp(
        `${splatLibrary}/(node_modules|build|engine|android/(build|.cxx))/.*`,
      ),
      new RegExp(
        `${onDeviceLibrary}/(node_modules|build|ios/KokoroResources|android/(build|.cxx))/.*`,
      ),
      new RegExp(`${bundledPack}/(?!manifest\\.json$).*`),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(appRoot), config);
