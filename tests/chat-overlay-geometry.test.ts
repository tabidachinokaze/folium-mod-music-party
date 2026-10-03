import { describe, expect, it } from 'vitest'
import { chatOverlayLayout } from '../src/client/chat-overlay-geometry'

// tests/chat-overlay-geometry.test.ts
describe('floating chat space inside the player', () => {
  it('uses the available player height instead of a fixed message-list cap', () => {
    expect(chatOverlayLayout({ left: 0, top: 0, width: 1280, height: 900 }, [])).toEqual({
      left: 24,
      width: 340,
      bottom: 32,
      height: 844,
    })
  })

  it('measures bottom obstacles relative to an inset player and leaves a gap', () => {
    const stage = { left: 80, top: 50, width: 1000, height: 700 }
    const layout = chatOverlayLayout(stage, [
      { left: 104, top: 650, width: 260, height: 70 },
      // A right-side control does not reserve space on the left.
      { left: 880, top: 580, width: 180, height: 140 },
    ])
    expect(layout).toEqual({ left: 24, width: 340, bottom: 112, height: 564 })
    expect(stage.top + stage.height - layout.bottom).toBe(650 - 12)
  })

  it('respects the native bottom inset and keeps horizontal margins in a narrow player', () => {
    const layout = chatOverlayLayout({ left: 20, top: 20, width: 300, height: 600 }, [], 72)
    expect(layout).toEqual({ left: 10, width: 280, bottom: 72, height: 504 })
    expect(layout.left * 2 + layout.width).toBe(300)
  })

  it('leaves space below a visible top-left control while still avoiding bottom controls', () => {
    const stage = { left: 80, top: 50, width: 1000, height: 700 },
      bottomControl = { left: 104, top: 650, width: 260, height: 70 },
      back = { left: 104, top: 74, width: 40, height: 40, edge: 'top' as const }
    const layout = chatOverlayLayout(stage, [back, bottomControl])
    expect(layout.bottom).toBe(112)
    expect(stage.top + stage.height - layout.bottom - layout.height).toBe(back.top + 40 + 12)
    // Without the visible control, messages recover the player's normal top margin.
    expect(chatOverlayLayout(stage, [bottomControl]).height - layout.height).toBe(52)
  })

  it('does not reserve top space for a control on the other side of the player', () => {
    const stage = { left: 0, top: 0, width: 1000, height: 700 }
    expect(
      chatOverlayLayout(stage, [{ left: 900, top: 24, width: 40, height: 40, edge: 'top' }]).height,
    ).toBe(chatOverlayLayout(stage, []).height)
  })

  it('ignores full-player wrappers but allows explicitly marked wide bottom controls', () => {
    const stage = { left: 0, top: 0, width: 1000, height: 700 },
      wide = { left: 0, top: 500, width: 1000, height: 150 }
    expect(chatOverlayLayout(stage, [wide]).bottom).toBe(32)
    expect(chatOverlayLayout(stage, [{ ...wide, allowWide: true }]).bottom).toBe(212)
  })

  it('never produces a negative available height for a collapsed stage', () => {
    const layout = chatOverlayLayout({ left: 0, top: 0, width: 320, height: 0 }, [], 72)
    expect(layout.height).toBe(0)
    expect(layout.bottom).toBe(0)
  })
})
