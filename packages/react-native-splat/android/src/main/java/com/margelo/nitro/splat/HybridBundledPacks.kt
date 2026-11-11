package com.margelo.nitro.splat

import android.content.res.AssetManager
import com.margelo.nitro.NitroModules

/** Reads the manifests the build copied under the APK's `packs` assets, where [BundledPack] installs from. */
class HybridBundledPacks : HybridBundledPacksSpec() {
  override fun manifests(): Array<BundledPackManifest> {
    val assets = requireNotNull(NitroModules.applicationContext).assets
    val found = mutableListOf<BundledPackManifest>()
    for (packId in children(assets, PACKS)) {
      for (version in children(assets, "$PACKS/$packId")) {
        val directory = "$packId/$version"
        if (MANIFEST !in children(assets, "$PACKS/$directory")) continue
        // An unreadable manifest is a broken bundle, so it fails discovery instead of hiding the pack.
        val manifest = assets.open("$PACKS/$directory/$MANIFEST").use { String(it.readBytes(), Charsets.UTF_8) }
        found.add(BundledPackManifest(directory, manifest))
      }
    }
    return found.sortedBy { it.directory }.toTypedArray()
  }

  private fun children(assets: AssetManager, path: String): List<String> = assets.list(path)?.toList() ?: emptyList()

  private companion object {
    const val PACKS = "packs"
    const val MANIFEST = "manifest.json"
  }
}
