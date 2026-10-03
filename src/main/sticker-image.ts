import { MEDIA_LIMITS, neteaseAssetUrl, type MediaFile } from '@party/shared/media'

// src/main/sticker-image.ts
const formats: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
}

/** Download only public NetEase image assets, never forwarding account credentials. */
export async function downloadStickerImage(
  value: unknown,
  fetcher: typeof fetch,
  assertCurrent: () => void,
): Promise<MediaFile> {
  const image = value as { kind?: unknown; url?: unknown; width?: unknown; height?: unknown } | null
  const initialUrl = neteaseAssetUrl(image?.url)
  if (!initialUrl || image?.kind !== 'image') throw new Error('图片地址不可用于添加表情包')
  let url: string = initialUrl
  if (
    [image.width, image.height].some(
      (value) => !Number.isSafeInteger(value) || Number(value) <= 0 || Number(value) > 30000,
    )
  )
    throw new Error('无法读取图片或视频尺寸')
  const signal = AbortSignal.timeout(15000)
  for (let redirects = 0; redirects <= 3; redirects++) {
    assertCurrent()
    const response = await fetcher(url, {
      method: 'GET',
      redirect: 'manual',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'image/png,image/jpeg,image/gif,image/webp' },
      signal,
    })
    try {
      assertCurrent()
    } catch (error) {
      await response.body?.cancel().catch(() => {})
      throw error
    }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      await response.body?.cancel()
      const location = response.headers.get('location')
      const next = location && neteaseAssetUrl(new URL(location, url).href)
      if (!next || redirects === 3) throw new Error('图片地址不可用于添加表情包')
      url = next
      continue
    }
    const mime = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() || ''
    if (!response.ok || !Object.hasOwn(formats, mime)) {
      await response.body?.cancel()
      throw new Error('请选择 PNG、JPEG、GIF 或 WebP 图片')
    }
    const size = response.headers.get('content-length')
    if (size && (!/^\d+$/.test(size) || Number(size) > MEDIA_LIMITS.image)) {
      await response.body?.cancel()
      throw new Error('图片数据无效或超过 20 MB')
    }
    const reader = response.body?.getReader()
    if (!reader) throw new Error('无法读取图片')
    const chunks: Uint8Array[] = []
    let bytes = 0
    try {
      for (;;) {
        const { value, done } = await reader.read()
        assertCurrent()
        signal.throwIfAborted()
        if (done) break
        bytes += value.byteLength
        if (bytes > MEDIA_LIMITS.image) throw new Error('图片数据无效或超过 20 MB')
        chunks.push(value)
      }
    } finally {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
    const data = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      data.set(chunk, offset)
      offset += chunk.byteLength
    }
    // MediaSender validates the signature against this MIME before requesting any upload token.
    return {
      kind: 'image',
      name: `message-sticker.${formats[mime]}`,
      mime,
      data,
      width: Number(image.width),
      height: Number(image.height),
    }
  }
  throw new Error('图片地址不可用于添加表情包')
}
