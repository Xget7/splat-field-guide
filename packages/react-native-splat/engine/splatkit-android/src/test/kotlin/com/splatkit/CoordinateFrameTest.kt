package com.splatkit

import org.junit.Assert.*
import org.junit.Test

class CoordinateFrameTest {
    private val letters = "rludbf"

    @Test fun parsesNamedFramesInEitherCase() {
        assertEquals(CoordinateFrame.RUB, CoordinateFrame.parse("rub"))
        assertEquals(CoordinateFrame.RDF, CoordinateFrame.parse("RDF"))
        assertEquals("rfu", CoordinateFrame.parse("rFu")?.letters)
        assertEquals("rdf", CoordinateFrame.RDF.letters)
        assertEquals("rub", CoordinateFrame.RUB.letters)
    }

    @Test fun acceptsExactlyTheFortyEightFramesOnThreeDistinctAxes() {
        val accepted = letters.flatMap { x -> letters.flatMap { y -> letters.map { z -> "$x$y$z" } } }
            .mapNotNull { CoordinateFrame.parse(it) }
        assertEquals(48, accepted.size)
        accepted.forEach { assertEquals(it, CoordinateFrame.parse(it.letters)) }
    }

    @Test fun rejectsRepeatedAxesWrongLengthsAndUnknownLetters() {
        listOf("rrr", "rlu", "udb", "ru", "rubf", "", "xyz", "ru ", "rüb").forEach {
            assertNull(it, CoordinateFrame.parse(it))
        }
    }
}
