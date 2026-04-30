import { describe, expect, it } from 'vitest'
import { AVAILABLE_FEATURES, LEGACY_FEATURE_ALIASES } from '@/lib/license/constants'
import { crc16, encodeBase62, packLicenseData, xorEncrypt } from '@/lib/license/crypto-simple'
import { validateLicenseCodeV3 } from '@/lib/license/validator-v3'

function licenseCodeFor(features: number): string {
  const packedData = packLicenseData({
    customerIndex: 12,
    expireMonths: 72,
    features,
    maxJobs: 25,
    maxDuration: 0,
  })
  const encoded = encodeBase62(xorEncrypt(packedData))
  return `CCUT-${encoded}-${crc16(encoded)}`
}

describe('V3 license feature normal form', () => {
  it('maps stored feature bits to current product capabilities', () => {
    const result = validateLicenseCodeV3(licenseCodeFor(0b111))

    expect(result.valid).toBe(true)
    expect(result.license?.features).toEqual([
      AVAILABLE_FEATURES.CONTENT_INGEST,
      AVAILABLE_FEATURES.TRANSLATION_DUBBING,
      AVAILABLE_FEATURES.CREATOR_ASSETS,
    ])
    expect(result.license?.features).not.toContain('single_video')
    expect(result.license?.features).not.toContain('multi_video')
    expect(result.license?.features).not.toContain('all_styles')
  })

  it('keeps old feature names only as generator input aliases', () => {
    expect(LEGACY_FEATURE_ALIASES).toEqual({
      single_video: AVAILABLE_FEATURES.CONTENT_INGEST,
      multi_video: AVAILABLE_FEATURES.TRANSLATION_DUBBING,
      all_styles: AVAILABLE_FEATURES.CREATOR_ASSETS,
    })
  })
})
