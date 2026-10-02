import { afterEach, expect, it, vi } from 'vitest'
import type { MessageAttachment } from '@party/shared/types'
import { createPrivateResourceActivation, privateResourceLabel } from '../src/client/private-music'
import { setLocale } from '../src/client/i18n'

// tests/private-resource-rendering.test.ts
const resource: MessageAttachment = {
  kind: 'resource',
  resourceType: 'song',
  resourceId: '9',
  title: '一首歌',
}
afterEach(() => setLocale('zh-CN'))

it('requires an explicit activation and coalesces only concurrent clicks on the same resource', async () => {
  let finish = () => {}
  const pending = new Promise<void>((resolve) => (finish = resolve)),
    actions = {
      canActivate: vi.fn(() => true),
      label: () => 'Play',
      activate: vi.fn(async () => pending),
    },
    busy = vi.fn(),
    activate = createPrivateResourceActivation(resource, actions, () => true, busy)
  expect(actions.activate).not.toHaveBeenCalled()
  const first = activate()
  await activate()
  expect(actions.activate).toHaveBeenCalledExactlyOnceWith(resource)
  expect(busy.mock.calls).toEqual([[true]])
  finish()
  await first
  expect(busy.mock.calls).toEqual([[true], [false]])
  await activate()
  expect(actions.activate).toHaveBeenCalledTimes(2)
})

it('rechecks availability and supported action after the view changes and resets busy after failures', async () => {
  let available = false,
    supported = true
  const actions = {
      canActivate: () => supported,
      label: () => 'Play',
      activate: vi.fn(async () => {
        throw new Error('failed')
      }),
    },
    busy = vi.fn(),
    activate = createPrivateResourceActivation(resource, actions, () => available, busy)
  await activate()
  available = true
  supported = false
  await activate()
  expect(actions.activate).not.toHaveBeenCalled()
  expect(busy).not.toHaveBeenCalled()
  supported = true
  await expect(activate()).rejects.toThrow('failed')
  expect(busy.mock.calls).toEqual([[true], [false]])
  available = false
  await activate()
  expect(actions.activate).toHaveBeenCalledTimes(1)
})

it('localizes known resource types without relabeling official promotion tags as playable music', () => {
  setLocale('en')
  expect(privateResourceLabel(resource)).toBe('Song')
  expect(privateResourceLabel({ ...resource, resourceType: 'album' })).toBe('Album')
  expect(privateResourceLabel({ ...resource, resourceType: 'artist' })).toBe('Artist')
  expect(privateResourceLabel({ ...resource, resourceType: 'general', label: '预约' })).toBe('预约')
  expect(privateResourceLabel({ ...resource, resourceType: 'unknown' })).toBe('Shared')
  setLocale('zh-CN')
  expect(privateResourceLabel(resource)).toBe('单曲')
})
