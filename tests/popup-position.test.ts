import { describe, expect, it } from 'vitest'
import {
  contextualPopupPosition,
  dropdownPopupPosition,
  playerPopupBounds,
  popupPosition,
} from '../src/client/popup-position'

// tests/popup-position.test.ts
const anchor = { left: 1550, right: 1680, top: 760, bottom: 790 }
const panel = { left: 1406, right: 1726, top: 210, bottom: 1090 }
const viewport = { width: 1760, height: 1100 }
const size = { width: 340, height: 400 }

describe('nested dropdown placement', () => {
  const trigger = { left: 300, right: 400, top: 300, bottom: 330 },
    screen = { width: 1000, height: 800 },
    menu = { width: 160, height: 100 }

  it('opens below its own trigger with a four-pixel gap', () => {
    expect(dropdownPopupPosition(trigger, screen, menu)).toEqual({
      left: 300,
      top: 334,
      width: 160,
      maxHeight: 180,
      side: 'below',
    })
  })
  it('flips above a trigger near the viewport bottom', () => {
    const placed = dropdownPopupPosition({ ...trigger, top: 710, bottom: 740 }, screen, menu)
    expect(placed).toMatchObject({ top: 606, side: 'above', maxHeight: 180 })
    expect(placed.top + menu.height).toBe(706)
  })
  it('keeps short menus below when their actual height fits', () => {
    expect(
      dropdownPopupPosition({ ...trigger, top: 680, bottom: 710 }, screen, { ...menu, height: 60 }),
    ).toMatchObject({ top: 714, maxHeight: 78, side: 'below' })
  })
  it('caps a large menu at 180 pixels and reserves the initial measurement space', () => {
    expect(dropdownPopupPosition(trigger, screen, { ...menu, height: 900 })).toMatchObject({
      maxHeight: 180,
      top: 334,
    })
    expect(dropdownPopupPosition(trigger, screen, { ...menu, height: 0 }).maxHeight).toBe(180)
  })
  it('uses the larger available side in a short viewport without leaving its gutter', () => {
    const placed = dropdownPopupPosition(
      { left: 10, right: 150, top: 60, bottom: 90 },
      { width: 180, height: 140 },
      { width: 200, height: 300 },
    )
    expect(placed).toEqual({ left: 8, top: 8, width: 164, maxHeight: 48, side: 'above' })
    expect(placed.top + placed.maxHeight).toBe(56)
  })
  it('clamps both horizontal edges independently of a parent panel', () => {
    expect(dropdownPopupPosition({ ...trigger, left: 960, right: 990 }, screen, menu).left).toBe(
      832,
    )
    expect(dropdownPopupPosition({ ...trigger, left: 0, right: 30 }, screen, menu).left).toBe(8)
  })
})

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
  it('flips below the visible chat-list top even when viewport space exists above it', () => {
    const placed = contextualPopupPosition({ ...image, top: 354, bottom: 534 }, viewport, size, {
      top: 350,
      bottom: 760,
    })
    expect(placed).toMatchObject({ top: 544, side: 'below', maxHeight: 410 })
  })
  it('uses the visible image portion when its top is clipped by chat scrolling', () => {
    const placed = contextualPopupPosition({ ...image, top: 300, bottom: 480 }, viewport, size, {
      top: 350,
      bottom: 760,
    })
    expect(placed).toMatchObject({ top: 490, side: 'below' })
  })
  it('keeps a bottom-edge message menu above the image and inside the chat list', () => {
    const placed = contextualPopupPosition({ ...image, top: 570, bottom: 750 }, viewport, size, {
      top: 350,
      bottom: 760,
    })
    expect(placed).toMatchObject({ top: 512, side: 'above' })
    expect(placed.top).toBeGreaterThanOrEqual(350)
    expect(placed.top + size.height).toBeLessThanOrEqual(760)
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

describe('player clearance for expanded sticker libraries', () => {
  it('derives available bounds from the native maximum height and bottom baseline', () => {
    const bounds = playerPopupBounds(1020, { bottom: 988, maxHeight: 932 })
    expect(bounds).toEqual({ top: 56, bottom: 988 })
    const shortPanel = { left: 800, right: 1120, top: 688, bottom: 988 }
    const placed = popupPosition(
      anchor,
      shortPanel,
      { width: 1200, height: 1020 },
      { width: 320, height: 1500 },
      'end',
      true,
      bounds,
    )
    expect(placed).toMatchObject({ top: 56, maxHeight: 932 })
    expect(placed.maxHeight).toBeGreaterThan(shortPanel.bottom - shortPanel.top)
  })
  it('retains native clearance as the player viewport shrinks or its baseline moves', () => {
    expect(playerPopupBounds(560, { bottom: 528, maxHeight: 472 })).toEqual({
      top: 56,
      bottom: 528,
    })
    expect(playerPopupBounds(560, { bottom: 488, maxHeight: 432 })).toEqual({
      top: 56,
      bottom: 488,
    })
  })
  it('uses the private page visible range when no player sidebar is present', () => {
    const bounds = playerPopupBounds(560, null, { top: 65, bottom: 525 })
    const placed = popupPosition(
      anchor,
      null,
      { width: 1100, height: 560 },
      { width: 320, height: 900 },
      'end',
      true,
      bounds,
    )
    expect(placed).toMatchObject({ top: 65, maxHeight: 460 })
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

describe('bottom-left floating chat popup placement', () => {
  const floating = { left: 24, right: 344, top: 480, bottom: 760 },
    trigger = { left: 150, right: 178, top: 716, bottom: 744 },
    screen = { width: 1200, height: 800 }

  it('opens beside the right edge of the whole chat window', () => {
    const placed = popupPosition(trigger, floating, screen, size, 'end', false, undefined, 'right')
    expect(placed).toEqual({ width: 340, left: 356, top: 344 })
    expect(placed.left).toBeGreaterThan(floating.right)
  })
  it('prefers the right side even when there is also enough space on the left', () => {
    const centered = { ...floating, left: 380, right: 700 }
    const placed = popupPosition(trigger, centered, screen, size, 'end', false, undefined, 'right')
    expect(placed.left).toBe(712)
    expect(popupPosition(trigger, centered, screen, size).left).toBe(28)
  })
  it('falls back to the left if the preferred side cannot fit a useful width', () => {
    const moved = { ...floating, left: 820, right: 1140 }
    const placed = popupPosition(trigger, moved, screen, size, 'end', false, undefined, 'right')
    expect(placed.left + placed.width).toBe(moved.left - 12)
  })
  it('clamps the overlapping fallback to a narrow viewport', () => {
    const placed = popupPosition(
      trigger,
      floating,
      { width: 360, height: 800 },
      size,
      'end',
      false,
      undefined,
      'right',
    )
    expect(placed.left).toBeGreaterThanOrEqual(8)
    expect(placed.left + placed.width).toBeLessThanOrEqual(352)
  })
  it('keeps native player clearance independently of the short floating chat window', () => {
    const bounds = playerPopupBounds(800, { bottom: 768, maxHeight: 712 })
    const placed = popupPosition(
      trigger,
      floating,
      screen,
      { width: 320, height: 1400 },
      'end',
      true,
      bounds,
      'right',
    )
    expect(placed).toMatchObject({ left: 356, top: 56, maxHeight: 712 })
    expect(placed.maxHeight).toBeGreaterThan(floating.bottom - floating.top)
    expect(placed.top + placed.maxHeight!).toBe(768)
  })
})

describe('top-right private conversation popup placement', () => {
  const conversation = { left: 696, right: 1076, top: 90, bottom: 584 },
    trigger = { left: 850, right: 896, top: 538, bottom: 568 },
    screen = { width: 1100, height: 720 }

  it('opens outside the conversation left edge with the same side gap as room chat', () => {
    const placed = popupPosition(trigger, conversation, screen, { width: 320, height: 280 })
    expect(placed).toEqual({ left: 364, top: 288, width: 320 })
    expect(placed.left + placed.width).toBe(conversation.left - 12)
  })

  it('limits a growing library to native player clearance rather than the dialog height', () => {
    const bounds = playerPopupBounds(720, { bottom: 688, maxHeight: 632 }),
      placed = popupPosition(
        trigger,
        conversation,
        screen,
        { width: 320, height: 900 },
        'end',
        true,
        bounds,
      )
    expect(placed).toMatchObject({ left: 364, top: 56, maxHeight: 632 })
    expect(placed.maxHeight).toBeGreaterThan(conversation.bottom - conversation.top)
  })

  it('keeps tools in the viewport when the compact conversation leaves no usable side', () => {
    const placed = popupPosition(
      { left: 190, right: 220, top: 390, bottom: 420 },
      { left: 12, right: 348, top: 78, bottom: 468 },
      { width: 360, height: 480 },
      { width: 320, height: 240 },
    )
    expect(placed).toEqual({ left: 28, top: 180, width: 320 })
  })
})
