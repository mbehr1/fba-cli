import { describe, expect, it } from 'vitest'
import { version, containsRegexChars, retryOperation } from './util'

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

describe('retryOperation', () => {
  it('should not retry if first call succeeds', async () => {
    const op = (retriesLeft: number) => Promise.resolve(retriesLeft)
    const res = await retryOperation(op, 1, 3)
    expect(res).toBe(3)
  })

  it('should retry if first calls fails', async () => {
    const op = (retriesLeft: number) => {
      return retriesLeft >= 2 ? Promise.reject('fail') : Promise.resolve(retriesLeft)
    }
    const res = await retryOperation(op, 1, 3)
    expect(res).toBe(1)
  })

  it('should return ok if last succeeds', async () => {
    const op = (retriesLeft: number) => {
      return retriesLeft > 0 ? Promise.reject('fail') : Promise.resolve(retriesLeft)
    }
    const res = await retryOperation(op, 0, 3)
    expect(res).toBe(0)
  })

  it('should return an error if all retries fail', async () => {
    const op = (retriesLeft: number) => Promise.reject('fail @' + retriesLeft)
    try {
      await retryOperation(op, 0, 3)
      expect('should have thrown').toBe('but did not')
    } catch (e) {
      expect(e).toBe('fail @0')
    }
  })
})
