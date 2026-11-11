package com.splatkit

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RenderPolicyTest {
    @Test
    fun roundTripsEveryPolicyField() {
        val policy = RenderPolicy(
            lodErrorPixels = 1.25f,
            lodSplatLimit = 1_500_000,
            alphaThreshold = 0.5f,
            subpixelThreshold = 2.5f,
            enableFrustumCulling = false,
            enableHiZOcclusion = true,
            enableEarlyTermination = false,
            sortDepth = SortDepth.BITS_16,
        )
        val encoded = DoubleArray(RENDER_POLICY_FIELDS)
        encodeRenderPolicy(policy, encoded)
        assertEquals(policy, decodeRenderPolicy(encoded))
    }

    @Test
    fun theSubpixelThresholdDefaultsToOnePixel() {
        assertEquals(1f, RenderPolicy().subpixelThreshold)
    }

    @Test
    fun theSortDepthDefaultsTo16Bits() {
        assertEquals(SortDepth.BITS_16, RenderPolicy().sortDepth)
    }

    @Test
    fun validationMirrorsTheJsRanges() {
        assertNull(renderPolicyError(RenderPolicy()))
        assertTrue(renderPolicyError(RenderPolicy(lodErrorPixels = 0f)) != null)
        assertTrue(renderPolicyError(RenderPolicy(lodErrorPixels = Float.NaN)) != null)
        assertTrue(renderPolicyError(RenderPolicy(lodSplatLimit = -1)) != null)
        assertTrue(renderPolicyError(RenderPolicy(alphaThreshold = 1.5f)) != null)
        assertTrue(renderPolicyError(RenderPolicy(alphaThreshold = -0.1f)) != null)
        assertTrue(renderPolicyError(RenderPolicy(subpixelThreshold = -1f)) != null)
        assertTrue(renderPolicyError(RenderPolicy(subpixelThreshold = Float.POSITIVE_INFINITY)) != null)
    }

    @Test
    fun decodesAnAcceptedResolutionWithItsWarnings() {
        val values = DoubleArray(RENDER_POLICY_RESOLUTION_FIELDS)
        values[0] = 1.0
        val effective = RenderPolicy(subpixelThreshold = 2f, sortDepth = SortDepth.BITS_16)
        encodeRenderPolicy(effective, values, offset = 2)

        val resolution = decodeRenderPolicyResolution(values, arrayOf("alphaThreshold fell back", "enableHiZOcclusion fell back"))
        assertTrue(resolution.accepted)
        assertFalse(resolution.preparationFailed)
        assertNull(resolution.error)
        assertEquals(effective, resolution.effective)
        assertEquals(listOf("alphaThreshold fell back", "enableHiZOcclusion fell back"), resolution.warnings)
    }

    @Test
    fun decodesARejectionAsItsReasonAndThePolicyStillInEffect() {
        val values = DoubleArray(RENDER_POLICY_RESOLUTION_FIELDS)
        values[1] = 1.0
        val previous = RenderPolicy(sortDepth = SortDepth.BITS_16)
        encodeRenderPolicy(previous, values, offset = 2)

        val resolution = decodeRenderPolicyResolution(values, arrayOf("pipeline rebuild failed"))
        assertFalse(resolution.accepted)
        assertTrue(resolution.preparationFailed)
        assertEquals("pipeline rebuild failed", resolution.error)
        assertEquals(previous, resolution.effective)
        assertTrue(resolution.warnings.isEmpty())
    }

    @Test
    fun decodesTheCapabilityLayout() {
        val values = DoubleArray(CAPABILITY_FIELDS)
        values[0] = 4_000_000.0
        values[1] = 100_000.0
        values[2] = 8_000_000.0
        values[4] = 1.0           // subgroups
        values[5] = 16_384.0
        values[8] = 1.0           // policy.subpixelThreshold supported
        values[12] = 1.0          // policy.sortDepth supported
        values[17] = 1.0          // policy.lodSplatLimit supported
        values[18] = 1.0          // fallback lodErrorPixels
        values[21] = 1.0          // fallback frustum culling
        values[24] = 32.0         // fallback sortDepth
        values[25] = 0.0          // fallback lodSplatLimit

        val capabilities = decodeDeviceCapabilities(values)
        assertEquals(4_000_000, capabilities.limits.maxLodCapacitySplats)
        assertEquals(8_000_000, capabilities.limits.maxResidencyCapacitySplats)
        assertFalse(capabilities.supportsHiZOcclusion)
        assertTrue(capabilities.supportsSubgroups)
        assertEquals(16_384, capabilities.maxTextureDimension)
        assertTrue(capabilities.policy.sortDepth)
        assertTrue(capabilities.policy.subpixelThreshold)
        assertTrue(capabilities.policy.lodSplatLimit)
        assertFalse(capabilities.policy.lodErrorPixels)
        assertEquals(1f, capabilities.fallback.lodErrorPixels)
        assertTrue(capabilities.fallback.enableFrustumCulling)
        assertEquals(SortDepth.BITS_32, capabilities.fallback.sortDepth)
        assertEquals(0, capabilities.fallback.lodSplatLimit)
    }
}
