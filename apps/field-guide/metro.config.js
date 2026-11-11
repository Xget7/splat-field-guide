const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const appRoot = __dirname;
const splatLibrary = path.resolve(appRoot, '../../packages/react-native-splat');
const onDeviceLibrary = path.resolve(
  appRoot,
  '../../packages/react-native-on-device',
);

/**
 * Linked packages must not shadow the app's React, React Native or Nitro runtimes.
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [splatLibrary, onDeviceLibrary],
  resolver: {
    nodeModulesPaths: [path.join(appRoot, 'node_modules')],
    blockList: [
      new RegExp(
        `${appRoot}/(ios/(Pods|build)|android/(build|app/build|app/.cxx|.gradle)|vendor)/.*`,
      ),
      new RegExp(
        `${splatLibrary}/(node_modules|build|engine|android/(build|.cxx))/.*`,
      ),
      new RegExp(
        `${onDeviceLibrary}/(node_modules|build|android/(build|.cxx))/.*`,
      ),
    ],
  },
};

module.exports = mergeConfig(getDefaultConfig(appRoot), config);
