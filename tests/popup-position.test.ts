import { describe, expect, it } from 'vitest'
import { contextualPopupPosition, popupPosition } from '../src/client/popup-position'

// tests/popup-position.test.ts
const anchor = { left: 1550, right: 1680, top: 760, bottom: 790 }
const panel = { left: 1406, right: 1726, top: 210, bottom: 1090 }
const viewport = { width: 1760, height: 1100 }
const size = { width: 340, height: 400 }

describe('message context popup placement', () => {
  const image = { left: 900, right: 1020, top: 400, bottom: 580 }
  const viewport = { width: 1100, height: 800 }
  const size = { width: 208, height: 48 }

  it('centers above the selected image with an arrow aimed at its center', () => {
    const placed = contextualPopupPosition(image, viewport, size)
    expect(placed).toMatchObject({ left: 856, top: 342, side: 'above', arrowLeft: 104 })
    expect(placed.top + size.height).toBe(image.top - 10)
  })
  it('flips below images near the top edge', () => {
    const placed = contextualPopupPosition({ ...image, top: 10, bottom: 190 }, viewport, size)
    expect(placed).toMatchObject({ top: 200, side: 'below', arrowLeft: 104 })
  })
  it('keeps edge menus inside the viewport while pointing back to the image', () => {
    const right = contextualPopupPosition({ ...image, left: 1060, right: 1100 }, viewport, size)
    expect(right.left + right.width).toBe(1092)
    expect(right.arrowLeft).toBe(192)
    const left = contextualPopupPosition({ ...image, left: 0, right: 40 }, viewport, size)
    expect(left.left).toBe(8)
    expect(left.arrowLeft).toBe(16)
  })
  it('clamps oversized menus and their pointers in narrow windows', () => {
    const placed = contextualPopupPosition(
      { left: 10, right: 90, top: 30, bottom: 80 },
      { width: 180, height: 140 },
      { width: 208, height: 200 },
    )
    expect(placed).toMatchObject({ left: 8, width: 164, top: 8, maxHeight: 124 })
    expect(placed.arrowLeft).toBeGreaterThanOrEqual(16)
    expect(placed.arrowLeft).toBeLessThanOrEqual(placed.width - 16)
  })
})

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
  it('lets a growing sticker collection use the player viewport beyond sidebar bounds', () => {
    const small = popupPosition(anchor, panel, viewport, { width: 320, height: 160 }, 'end', true)
    expect(small.top).toBe(630)
    expect(small.maxHeight).toBe(1084)
    const grown = popupPosition(anchor, panel, viewport, { width: 320, height: 1500 }, 'end', true)
    expect(grown.top).toBe(8)
    expect(grown.top + grown.maxHeight!).toBe(viewport.height - 8)
    expect(grown.left + grown.width).toBeLessThan(panel.left)
  })
  it('does not shrink a loaded collection when the sidebar becomes shorter', () => {
    const shorter = { ...panel, top: 390, bottom: 810 }
    const result = popupPosition(
      anchor,
      shorter,
      viewport,
      { width: 320, height: 1500 },
      'end',
      true,
    )
    expect(result.maxHeight).toBe(1084)
    expect(result.top).toBe(8)
    expect(result.maxHeight).toBeGreaterThan(shorter.bottom - shorter.top)
  })
  it('shrinks a loaded collection when the player viewport becomes shorter', () => {
    const result = popupPosition(
      anchor,
      panel,
      { ...viewport, height: 600 },
      { width: 320, height: 1500 },
      'end',
      true,
    )
    expect(result.top).toBe(8)
    expect(result.maxHeight).toBe(584)
    expect(result.top + result.maxHeight!).toBe(592)
  })
  it('uses viewport height in narrow windows that require overlapping placement', () => {
    const result = popupPosition(
      { left: 250, right: 290, top: 490, bottom: 510 },
      { left: 8, right: 292, top: 100, bottom: 540 },
      { width: 300, height: 550 },
      { width: 320, height: 900 },
      'end',
      true,
    )
    expect(result).toEqual({ left: 8, top: 8, width: 284, maxHeight: 534 })
  })
  it('also gives private sticker libraries full viewport height without a sidebar', () => {
    const result = popupPosition(anchor, null, viewport, { width: 320, height: 1500 }, 'end', true)
    expect(result.top).toBe(8)
    expect(result.maxHeight).toBe(1084)
    expect(result.top + result.maxHeight!).toBe(viewport.height - 8)
  })
})
