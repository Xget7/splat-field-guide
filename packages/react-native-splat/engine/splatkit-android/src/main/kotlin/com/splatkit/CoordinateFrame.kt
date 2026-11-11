package com.splatkit

private const val AXIS_COUNT = 3

// The two letters of each axis, one per direction along it.
private val AXIS_LETTERS = arrayOf("rl", "ud", "bf")

/**
 * Where a file's +X, +Y and +Z point, written as three letters from r, l, u, d, b and f:
 * [RUB] is glTF, OpenGL and three.js, [RDF] OpenCV, COLMAP and World Labs Marble, `rfu` Blender.
 * Any of the 48 conventions, right or left handed. Set it on [SplatSurfaceView.sourceFrame].
 */
class CoordinateFrame private constructor(
    /** The three lower case letters [parse] reads. */
    val letters: String,
) {
    override fun equals(other: Any?): Boolean = other is CoordinateFrame && other.letters == letters
    override fun hashCode(): Int = letters.hashCode()
    override fun toString(): String = letters

    companion object {
        val RUB = CoordinateFrame("rub")
        val RDF = CoordinateFrame("rdf")

        /**
         * The frame three letters name, in either case, or null unless they name three
         * distinct axes. The same rule as the native `splat::CoordinateFrame::parse`.
         */
        fun parse(letters: String): CoordinateFrame? {
            if (letters.length != AXIS_COUNT) return null
            val lower = letters.lowercase()
            val axes = lower.map { letter -> AXIS_LETTERS.indexOfFirst { letter in it } }
            if (axes.any { it < 0 } || axes.distinct().size != AXIS_COUNT) return null
            return CoordinateFrame(lower)
        }
    }
}
