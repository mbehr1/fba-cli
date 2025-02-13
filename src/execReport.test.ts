import { describe, expect, it } from 'vitest'
import { FbaExecReport, fbReportToMdast, hideBadgeValue, hideBadge2Value } from './execReport.js'
import { assert as mdassert } from 'mdast-util-assert'

describe('execReport', () => {
  it('should not fail on empty report', () => {
    const report: FbaExecReport ={
      type:'FbaExecReport',
      data:{
        files:[],
        pluginCfgs:"[]",
        lifecycles:[],
      } as any,
      children:[]
    }
    const mdast = fbReportToMdast(report)
    mdassert(mdast)
    expect(mdast.children).to.not.be.empty
})
})

describe('hideBadgeValue',()=>{
  it('should hide badge value for 0 or empty values',()=>{
    expect(hideBadgeValue(undefined)).toBe(true)
    expect(hideBadgeValue('')).toBe(true)
    expect(hideBadgeValue([])).toBe(true)
    expect(hideBadgeValue(0)).toBe(true)
    // now a few valid values
    expect(hideBadgeValue(1)).toBe(false)
    expect(hideBadgeValue("1")).toBe(false)
  })
})

describe('hideBadge2Value',()=>{
  it('should hide badge value for 0 or empty values',()=>{
    expect(hideBadge2Value(undefined)).toBe(true)
    expect(hideBadge2Value('')).toBe(true)
    expect(hideBadge2Value([])).toBe(true)
    // now a few valid values
    expect(hideBadge2Value(0)).toBe(false)
    expect(hideBadge2Value(1)).toBe(false)
    expect(hideBadge2Value("1")).toBe(false)
  })
})
