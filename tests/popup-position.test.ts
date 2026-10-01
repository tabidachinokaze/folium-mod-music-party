import { describe, expect, it } from 'vitest'
import { popupPosition } from '../src/client/popup-position'

// tests/popup-position.test.ts
const anchor = { left: 1550, right: 1680, top: 760, bottom: 790 }
const panel = { left: 1406, right: 1726, top: 210, bottom: 1090 }
const viewport = { width: 1760, height: 1100 }
const size = { width: 340, height: 400 }

describe('side panel popup placement', () => {
  it('uses the outer panel edge, leaving space for its padding and controls', () => {
    const result = popupPosition(anchor, panel, viewport, size, 'start')
    expect(result).toEqual({ width: 340, left: 1054, top: 692 })
    expect(result.left + result.width).toBeLessThan(panel.left)
  })
  it('aligns composer popups with the bottom of their trigger', () => {
    expect(popupPosition(anchor, panel, viewport, size).top).toBe(390)
  })
  it('uses the right side when the panel is at the left edge', () => {
    const result = popupPosition(anchor, { ...panel, left: 8, right: 328 }, viewport, size)
    expect(result.left).toBe(340)
  })
  it('uses a narrower left popup before falling back to covering the panel', () => {
    const result = popupPosition(anchor, { ...panel, left: 300, right: 620 }, viewport, size)
    expect(result).toMatchObject({ left: 8, width: 280 })
  })
  it('keeps popups accessible in a narrow viewport with no room beside the panel', () => {
    const result = popupPosition(
      { left: 250, right: 290, top: 490, bottom: 510 },
      { left: 8, right: 292, top: 10, bottom: 540 },
      { width: 300, height: 550 },
      size,
    )
    expect(result).toEqual({ left: 8, top: 110, width: 284 })
  })
  it('keeps private composer popups above their trigger, without a sidebar offset', () => {
    expect(popupPosition(anchor, null, viewport, size)).toEqual({
      width: 340,
      left: 1412,
      top: 348,
    })
  })
})
