import { inflateSync } from 'node:zlib'

// src/main/mini-codec.ts
// Wire-format interoperability for the music mini notification service. No SDK source is bundled.
const MAX_FRAME = 1024 * 1024
export function varint(value: number): Buffer {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_FRAME)
    throw new Error('通知数据长度无效')
  const bytes = []
  do {
    const byte = value % 128
    value = Math.floor(value / 128)
    bytes.push(byte | (value ? 128 : 0))
  } while (value)
  return Buffer.from(bytes)
}
function readVarint(bytes: Buffer, start = 0): [number, number] | null {
  let value = 0
  for (let i = 0; i < 4; i++) {
    if (start + i >= bytes.length) return null
    const byte = bytes[start + i]
    value += (byte & 127) * 2 ** (7 * i)
    if (value > MAX_FRAME) throw new Error('通知数据过大')
    if (!(byte & 128)) return [value, start + i + 1]
  }
  throw new Error('通知数据长度无效')
}
export function properties(fields: Record<number, string | number | Buffer>): Buffer {
  const entries = Object.entries(fields).sort(([a], [b]) => Number(a) - Number(b))
  return Buffer.concat([
    varint(entries.length),
    ...entries.flatMap(([key, value]) => {
      const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value))
      return [varint(Number(key)), varint(bytes.length), bytes]
    }),
  ])
}
export function readProperties(bytes: Buffer): Map<number, string> {
  let position = 0
  const number = () => {
    const result = readVarint(bytes, position)
    if (!result) throw new Error('通知字段不完整')
    position = result[1]
    return result[0]
  }
  const count = number(),
    result = new Map<number, string>()
  if (count > 256) throw new Error('通知字段过多')
  for (let i = 0; i < count; i++) {
    const key = number(),
      length = number()
    if (position + length > bytes.length || result.has(key)) throw new Error('通知字段无效')
    result.set(key, bytes.subarray(position, position + length).toString('utf8'))
    position += length
  }
  if (position !== bytes.length) throw new Error('通知字段长度不符')
  return result
}
export function frame(
  service: number,
  command: number,
  serial: number,
  body: Buffer = Buffer.alloc(0),
) {
  const header = Buffer.alloc(5)
  header[0] = service
  header[1] = command
  header.writeUInt16LE(serial, 2)
  return Buffer.concat([varint(header.length + body.length), header, body])
}
// RC4 is required by this legacy service. Independent states are used for each stream direction.
export function streamCipher(key: Buffer) {
  if (!key.length) throw new Error('通知密钥无效')
  const state = Uint8Array.from({ length: 256 }, (_, i) => i)
  let j = 0
  for (let i = 0; i < 256; i++) {
    j = (j + state[i] + key[i % key.length]) & 255
    ;[state[i], state[j]] = [state[j], state[i]]
  }
  let i = 0
  j = 0
  return (bytes: Buffer) => {
    const result = Buffer.alloc(bytes.length)
    for (let p = 0; p < bytes.length; p++) {
      i = (i + 1) & 255
      j = (j + state[i]) & 255
      ;[state[i], state[j]] = [state[j], state[i]]
      result[p] = bytes[p] ^ state[(state[i] + state[j]) & 255]
    }
    return result
  }
}
export class FrameReader {
  private pending: Buffer = Buffer.alloc(0)
  push(bytes: Buffer): Buffer[] {
    if (this.pending.length + bytes.length > MAX_FRAME + 4) throw new Error('通知数据过大')
    this.pending = Buffer.concat([this.pending, bytes])
    const frames: Buffer[] = []
    while (this.pending.length) {
      const length = readVarint(this.pending)
      if (!length) break
      const [size, start] = length
      if (size < 5) throw new Error('通知帧无效')
      if (this.pending.length < start + size) break
      frames.push(this.pending.subarray(start, start + size))
      this.pending = this.pending.subarray(start + size)
    }
    return frames
  }
}
export function packet(bytes: Buffer) {
  if (bytes.length < 5) throw new Error('通知帧不完整')
  const flags = bytes[4],
    offset = flags & 2 ? 7 : 5
  if (bytes.length < offset) throw new Error('通知帧不完整')
  let body = bytes.subarray(offset)
  if (flags & 1) {
    if (body.length < 4) throw new Error('通知压缩帧无效')
    const expected = body.readUInt32LE(0)
    if (expected > MAX_FRAME) throw new Error('通知数据过大')
    body = inflateSync(body.subarray(4), { maxOutputLength: MAX_FRAME })
    if (body.length !== expected) throw new Error('通知压缩长度不符')
  }
  return {
    service: bytes[0],
    command: bytes[1],
    status: flags & 2 ? bytes.readUInt16LE(5) : 200,
    body,
  }
}
export function embedded(bytes: Buffer, serial = 1) {
  if (bytes.length < 9) throw new Error('通知包装不完整')
  const length = readVarint(bytes, 8)
  if (!length) throw new Error('通知包装不完整')
  // The embedded length can be zero; the outer frame bounds the actual packet.
  const inner = bytes.subarray(length[1])
  const parsed = packet(inner)
  const header = Buffer.from(bytes.subarray(8, length[1] + (inner[4] & 2 ? 7 : 5)))
  header.writeUInt16LE(serial, length[1] - 8 + 2)
  return { id: bytes.subarray(0, 8), header, packet: parsed }
}
