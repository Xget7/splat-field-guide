module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.margelo.nitro.ondevice.OnDevicePackage;',
        packageInstance: 'new OnDevicePackage()',
      },
    },
  },
};
