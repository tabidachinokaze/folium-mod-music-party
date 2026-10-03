import { afterEach, describe, expect, it, vi } from 'vitest'
import { clipboardImage, createImageDraftState, validateImageFile } from '../src/client/image-draft'
import { uploadImage } from '../src/client/private-tools'
import type { PartyController } from '../src/client/controller'

// tests/image-draft.test.ts
const imageFile = (name = 'clipboard.png') => new File(['image bytes'], name, { type: 'image/png' })

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('image drafts', () => {
  it('stages a local preview without network access and releases replaced/cancelled URLs', () => {
    const create = vi
      .spyOn(URL, 'createObjectURL')
      .mockReturnValueOnce('blob:one')
      .mockReturnValueOnce('blob:two')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const draft = createImageDraftState(() => 'account:peer')
    const first = draft.select(imageFile())!
    expect(draft.isCurrent(first)).toBe(true)
    expect(first.url).toBe('blob:one')
    const second = draft.select(imageFile('selected.png'))!
    expect(draft.isCurrent(first)).toBe(false)
    expect(draft.isCurrent(second)).toBe(true)
    expect(revoke).toHaveBeenCalledWith('blob:one')
    draft.clear()
    expect(draft.isCurrent(second)).toBe(false)
    expect(draft.current).toBeNull()
    expect(revoke).toHaveBeenCalledWith('blob:two')
    expect(create).toHaveBeenCalledTimes(2)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it.each(['account:another-peer', 'other-account:peer', null])(
    'rejects a staged image when its destination becomes %s',
    (next) => {
      vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
      vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
      let context: string | null = 'account:peer'
      const draft = createImageDraftState(() => context)
      const selection = draft.select(imageFile())!
      context = next
      expect(draft.isCurrent(selection)).toBe(false)
      draft.clear()
      context = 'account:peer'
      expect(draft.isCurrent(selection)).toBe(false)
      draft.dispose()
      expect(draft.select(imageFile())).toBeNull()
    },
  )

  it('does not create a preview for a missing destination or unsupported/oversized file', () => {
    const create = vi.spyOn(URL, 'createObjectURL')
    const draft = createImageDraftState(() => null)
    expect(draft.select(imageFile())).toBeNull()
    expect(() =>
      validateImageFile(new File(['svg'], 'test.svg', { type: 'image/svg+xml' })),
    ).toThrow('PNG')
    expect(() => validateImageFile(new File([], 'empty.png', { type: 'image/png' }))).toThrow(
      '20 MB',
    )
    const large = imageFile()
    Object.defineProperty(large, 'size', { value: 20 * 1024 * 1024 + 1 })
    expect(() => validateImageFile(large)).toThrow('20 MB')
    expect(create).not.toHaveBeenCalled()
  })

  it('picks clipboard image files without treating ordinary text as an attachment', () => {
    const image = imageFile()
    const transfer = {
      items: [
        { kind: 'string', type: 'text/html', getAsFile: () => null },
        { kind: 'file', type: 'image/png', getAsFile: () => image },
      ],
      files: [],
    } as unknown as DataTransfer
    expect(clipboardImage(transfer)).toBe(image)
    expect(clipboardImage({ items: [], files: [image] } as unknown as DataTransfer)).toBe(image)
    expect(clipboardImage({ items: [], files: [] } as unknown as DataTransfer)).toBeNull()
    expect(clipboardImage(null)).toBeNull()
  })

  it('rechecks cancellation after file reading before sending to the captured chat', async () => {
    let active = true
    const attachment = vi.fn()
    const controller = {
      state: { account: { uid: '9' } },
      connection: { attachment },
    } as unknown as PartyController
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    vi.stubGlobal(
      'Image',
      class {
        src = ''
        naturalWidth = 1
        naturalHeight = 1
        async decode() {}
      },
    )
    vi.stubGlobal(
      'FileReader',
      class {
        result = 'data:image/png;base64,aW1hZ2U='
        onload = () => {}
        readAsDataURL() {
          active = false
          this.onload()
        }
      },
    )
    await expect(
      uploadImage(controller, imageFile(), { kind: 'private', uid: '10' }, () => active),
    ).rejects.toThrow('聊天已变化')
    expect(attachment).not.toHaveBeenCalled()
    expect(revoke).toHaveBeenCalledWith('blob:test')
  })
})
