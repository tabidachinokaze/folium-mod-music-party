import { describe, expect, it } from 'vitest'
import { privateBubbleLayout } from '../src/client/private-bubble-geometry'

describe('player private conversation space', () => {
  it('reserves separate vertical space for an incoming notification and an open conversation', () => {
    const stage = { left: 0, top: 0, width: 1100, height: 720 }
    const normal = privateBubbleLayout(stage, [], false)
    const incoming = privateBubbleLayout(stage, [], false, true)
    expect(normal.top).toBe(24)
    expect(normal.dialogTop).toBe(normal.top + 66)
    expect(incoming.dialogTop).toBe(normal.dialogTop + 112)
    expect(incoming.toastTop).toBe(normal.toastTop)
    expect(incoming.dialogTop + incoming.height + incoming.bottom).toBeLessThanOrEqual(stage.height)
  })

  it('keeps the conversation next to the native panel without crossing the player edge', () => {
    const stage = { left: 50, top: 30, width: 1200, height: 900 }
    const panel = { left: 900, top: 150, width: 320, height: 720 }
    const layout = privateBubbleLayout(stage, [panel], true)
    expect(stage.left + stage.width - layout.right).toBe(panel.left - 12)
    expect(layout.width).toBe(380)
    expect(stage.width - layout.right - layout.width).toBeGreaterThanOrEqual(24)
  })

  it('leaves room above bottom controls only when they intersect the conversation', () => {
    const stage = { left: 50, top: 20, width: 1100, height: 720 }
    const layout = privateBubbleLayout(
      stage,
      [
        { left: 810, top: 600, width: 300, height: 120 },
        { left: 60, top: 440, width: 200, height: 280 },
      ],
      false,
    )
    expect(stage.top + stage.height - layout.bottom).toBe(588)
  })

  it('keeps horizontal margins and usable conversation height in a short narrow player', () => {
    const stage = { left: 0, top: 0, width: 360, height: 300 }
    const layout = privateBubbleLayout(stage, [], true, true)
    expect(layout.width + layout.right * 2).toBe(360)
    expect(layout.height).toBeGreaterThan(190)
    expect(layout.toastTop + layout.toastHeight).toBeLessThanOrEqual(288)
    expect(layout).toEqual(privateBubbleLayout(stage, [], true, false))
  })

  it('does not produce a negative size during a collapsed stage transition', () => {
    const layout = privateBubbleLayout({ left: 0, top: 0, width: 0, height: 0 }, [], true, true)
    expect(layout.width).toBe(0)
    expect(layout.height).toBe(0)
  })

  it('keeps the top-right rail below titlebar controls in an inset player', () => {
    const stage = { left: 50, top: 20, width: 1100, height: 720 }
    const layout = privateBubbleLayout(
      stage,
      [
        { left: 920, top: 20, width: 210, height: 40, edge: 'top' },
        { left: 74, top: 44, width: 40, height: 70, edge: 'top' },
      ],
      false,
    )
    expect(stage.top + layout.top).toBe(72)
    expect(layout.dialogTop).toBe(layout.top + 66)
  })

  it('respects wide top controls without treating a full-stage wrapper as an obstacle', () => {
    const stage = { left: 0, top: 0, width: 360, height: 640 }
    const layout = privateBubbleLayout(
      stage,
      [
        { ...stage, edge: 'top' },
        { left: 0, top: 0, width: 360, height: 64, edge: 'top' },
      ],
      false,
    )
    expect(layout.top).toBe(76)
    expect(layout.height + layout.dialogTop).toBeLessThanOrEqual(628)
  })
})
