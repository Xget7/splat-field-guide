module.exports = {
  dependency: {
    platforms: {
      android: {
        sourceDir: './android',
        packageImportPath: 'import com.margelo.nitro.splat.SplatPackage;',
        packageInstance: 'new SplatPackage()',
      },
    },
  },
};
