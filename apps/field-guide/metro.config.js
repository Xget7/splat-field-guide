const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const appRoot = __dirname;
const splatLibrary = path.resolve(appRoot, '../../packages/react-native-splat');
const onDeviceLibrary = path.resolve(
  appRoot,
  '../../packages/react-native-on-device',
);
const pinnedPack = path.resolve(appRoot, '../../content/gol-trend-engine-bay');

/**
 * Linked packages must not shadow the app's React, React Native or Nitro runtimes.
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [splatLibrary, onDeviceLibrary, pinnedPack],
  resolver: {
    nodeModulesPaths: [path.join(appRoot, 'node_modules')],
    // Only the pinned manifest is imported; preparation checks the downloaded pack against it,
    // and the pack's cloud and labels ship as app resources.
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
      new RegExp(`${pinnedPack}/(?!manifest\\.json$).*`),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(appRoot), config);
