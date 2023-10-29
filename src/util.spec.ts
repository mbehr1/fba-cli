import { describe, expect, it } from '@jest/globals'
import { version } from './util'

describe('getVersion', () => {
  it('should return the version', () => {
    expect(version()).toBe('1.0.2')
  })
})
