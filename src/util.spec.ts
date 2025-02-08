import { describe, expect, it } from 'vitest'
import { version, containsRegexChars } from './util'

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

describe('containsRegexChars', () => {
  it('should return false on regular chars', () => {
    expect(containsRegexChars('foo')).toBe(false)
  })
  it('should return false on e.g. pipe char', () => {
    expect(containsRegexChars('foo|bar')).toBe(true)
  })
  it('should return false on e.g. \\ char', () => {
    expect(containsRegexChars('foo\\bar')).toBe(true)
  })
})
