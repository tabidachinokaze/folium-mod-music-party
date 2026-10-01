import { deflateSync } from 'node:zlib'
import { expect, it } from 'vitest'
import {
  embedded,
  frame,
  FrameReader,
  packet,
  properties,
  readProperties,
  streamCipher,
} from '../src/main/mini-codec'

// tests/mini-codec.test.ts
it('matches the published RC4 test vector and preserves stream state across chunks', () => {
  const encrypt = streamCipher(Buffer.from('Key'))
  expect(
    Buffer.concat([encrypt(Buffer.from('Plain')), encrypt(Buffer.from('text'))]).toString('hex'),
  ).toBe('bbf316e8d940af0ad3')
})
it('handles fragmented and coalesced frames without losing bytes', () => {
  const source = Buffer.concat([
      frame(1, 2, 3),
      frame(7, 3, 4, properties({ 0: 123, 5: 'hello' })),
    ]),
    reader = new FrameReader()
  const decoded: Buffer[] = []
  for (const byte of source) decoded.push(...reader.push(Buffer.from([byte])))
  expect(decoded.map((p) => [packet(p).service, packet(p).command])).toEqual([
    [1, 2],
    [7, 3],
  ])
  expect(readProperties(packet(decoded[1]).body).get(5)).toBe('hello')
  expect(new FrameReader().push(source)).toHaveLength(2)
})
it('decodes compressed envelopes whose embedded length is zero and generates the receipt header', () => {
  const nested = Buffer.concat([
    Buffer.from([0, 7, 3, 0, 0, 0]),
    properties({ 0: 123, 1: 100, 5: 'hello' }),
  ])
  const id = Buffer.alloc(8)
  id.writeBigInt64LE(12n)
  const raw = Buffer.concat([id, nested]),
    size = Buffer.alloc(4)
  size.writeUInt32LE(raw.length)
  const outer = new FrameReader().push(frame(4, 1, 2, Buffer.concat([size, deflateSync(raw)])))[0]
  outer[4] = 1
  const decoded = embedded(packet(outer).body)
  expect(decoded.id.readBigInt64LE()).toBe(12n)
  expect(decoded.header.toString('hex')).toBe('000703010000')
  expect(readProperties(decoded.packet.body).get(5)).toBe('hello')
})
it('rejects oversized or malformed data instead of allocating unbounded memory', () => {
  expect(() => new FrameReader().push(Buffer.from([255, 255, 255, 255]))).toThrow()
  expect(() => readProperties(Buffer.from([1, 5, 127]))).toThrow()
  expect(() => embedded(Buffer.alloc(8))).toThrow()
  expect(() => packet(Buffer.from([1, 1, 0, 0, 2]))).toThrow()
})
