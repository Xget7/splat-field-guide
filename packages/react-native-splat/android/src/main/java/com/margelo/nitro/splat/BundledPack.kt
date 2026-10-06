package com.margelo.nitro.splat

import android.content.Context
import org.json.JSONObject
import java.io.File
import java.security.MessageDigest

/** The engine maps files, so APK assets become verified app-private files once per version. */
internal object BundledPack {
  @Synchronized
  fun resolve(context: Context, source: SplatSource): SplatSource {
    if (File(source.splatPath).isAbsolute) return source
    require(source.splatPath.startsWith("packs/")) { "Cloud is not in a bundled pack" }
    val segments = source.splatPath.split('/')
    require(segments.size >= 5 && segments.none { it == ".." }) { "Invalid pack path" }
    val base = segments.take(3).joinToString("/")
    val manifestBytes = context.assets.open("$base/manifest.json").use { it.readBytes() }
    val manifest = JSONObject(String(manifestBytes, Charsets.UTF_8))
    require(manifest.getString("packId") == segments[1] && manifest.getInt("packVersion").toString() == segments[2]) {
      "Pack identity does not match its directory"
    }
    val directory = File(context.filesDir, base)
    directory.mkdirs()
    val tiers = manifest.getJSONArray("tiers")
    val paths = mutableSetOf<String>()
    var matchingTier = false
    for (i in 0 until tiers.length()) {
      val tier = tiers.getJSONObject(i)
      val cloud = "$base/${tier.getJSONObject("cloud").getString("path")}"
      val labels = "$base/${tier.getJSONObject("labels").getString("path")}"
      if (source.splatPath == cloud && source.labelsPath == labels) matchingTier = true
      require(tier.getJSONObject("labels").getLong("bytes") == tier.getLong("splatCount") + LABEL_HEADER_BYTES) {
        "Pack count mismatch"
      }
      for (name in listOf("cloud", "labels")) {
        val record = tier.getJSONObject(name)
        val relative = record.getString("path")
        val file = File(directory, relative)
        require(!File(relative).isAbsolute && file.canonicalPath.startsWith(directory.canonicalPath + "/")) {
          "Pack file escapes its directory"
        }
        paths.add("$base/$relative")
        val digest = record.getString("sha256")
        val bytes = record.getLong("bytes")
        if (!valid(file, bytes, digest)) {
          file.parentFile!!.mkdirs()
          val temporary = File(file.parentFile, file.name + ".pending")
          try {
            context.assets.open("$base/$relative").use { input ->
              temporary.outputStream().use { input.copyTo(it) }
            }
            check(valid(temporary, bytes, digest)) { "Pack digest mismatch: $relative" }
            check(temporary.renameTo(file)) { "Cannot install pack file: $relative" }
          } finally {
            temporary.delete()
          }
        }
      }
    }
    require(matchingTier && source.splatPath in paths && source.labelsPath in paths) {
      "Files do not belong to one manifest tier"
    }
    File(directory, "manifest.json").writeBytes(manifestBytes)
    return SplatSource(File(context.filesDir, source.splatPath).path, File(context.filesDir, source.labelsPath).path)
  }

  private fun valid(file: File, bytes: Long, digest: String): Boolean {
    if (!file.isFile || file.length() != bytes) return false
    val sha = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
      val buffer = ByteArray(64 * 1024)
      while (true) {
        val count = input.read(buffer)
        if (count < 0) break
        sha.update(buffer, 0, count)
      }
    }
    return sha.digest().joinToString("") { "%02x".format(it) } == digest
  }

  private const val LABEL_HEADER_BYTES = 16L
}
