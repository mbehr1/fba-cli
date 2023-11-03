import { describe, expect, it } from '@jest/globals'
import { version } from './util'

describe('getVersion', () => {
  it('should return a version', () => {
    expect(version().length).toBeGreaterThan(4)
  })

  it('version should be a major.minor.patch tupel', () => {
    const v = version()
    expect(v).toMatch(/\d+\.\d+\.\d+/)

    // even if called twice (as impl caches)
    const v2 = version()
    expect(v2).toMatch(/\d+\.\d+\.\d+/)
  })
})
