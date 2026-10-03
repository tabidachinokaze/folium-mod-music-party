import { describe, expect, it } from 'vitest'
import { parseSnapshot } from '../vendor/music-party/src/shared/multiplayer'

// tests/room-visibility.test.ts
describe('official room visibility', () => {
  it.each([
    [1, false],
    [2, true],
    [3, true],
    ['1', false],
    ['2', true],
    ['3', true],
  ])('reads roomBizType %s from either official RoomInfo alias', (roomBizType, expected) => {
    for (const field of ['multiRoomInfoDTO', 'roomInfo']) {
      const room = parseSnapshot({ roomId: 'room', [field]: { roomBizType } }, 1)
      expect(room.allowStrangerMatch).toBe(expected)
      expect(room.roomBizType).toBe(Number(roomBizType))
    }
  })

  it.each([0, 4, -1, 1.5, '', '4', 'private', ' 1 ', '<b>new room type</b>'])(
    'preserves an unknown scalar room type without guessing its visibility: %s',
    (roomBizType) => {
      const room = parseSnapshot({ roomId: 'room', multiRoomInfoDTO: { roomBizType } }, 1)
      expect(room.roomBizType).toBe(roomBizType)
      expect(room.allowStrangerMatch).toBeNull()
    },
  )

  it.each([undefined, null, NaN, Infinity, true, false, [1], { valueOf: () => 1 }])(
    'does not coerce a malformed room type to an official enum: %s',
    (roomBizType) => {
      expect(parseSnapshot({ roomId: 'room', roomInfo: { roomBizType } }, 1).roomBizType).toBeNull()
    },
  )

  it.each([
    undefined,
    null,
    0,
    4,
    -1,
    1.5,
    NaN,
    Infinity,
    '',
    '0',
    '4',
    'private',
    ' 1 ',
    true,
    false,
    [1],
    { valueOf: () => 1 },
  ])('keeps an absent or unrecognized room type unknown: %s', (roomBizType) => {
    expect(
      parseSnapshot({ roomId: 'room', multiRoomInfoDTO: { roomBizType } }, 1).allowStrangerMatch,
    ).toBeNull()
  })

  it('does not infer visibility from the create switch, room mode, lifecycle, or another DTO', () => {
    expect(
      parseSnapshot(
        {
          roomId: 'room',
          type: 1,
          allowStrangerMatch: false,
          multiRoomBizType: 1,
          multiRoomInfoDTO: {
            type: 1,
            allowStrangerMatch: false,
            roomType: 'MULTI_INVITE',
            roomStatus: 1,
            roomClosed: false,
          },
          roomPlaySongInfo: { roomBizType: 1 },
        },
        1,
      ).allowStrangerMatch,
    ).toBeNull()
    expect(parseSnapshot({ roomId: 'room' }, 1)).toMatchObject({
      roomBizType: null,
      allowStrangerMatch: null,
    })
  })

  it('prefers the canonical server DTO even when another alias disagrees', () => {
    expect(
      parseSnapshot(
        {
          roomId: 'room',
          multiRoomInfoDTO: { roomBizType: 2 },
          roomInfo: { roomBizType: 1 },
        },
        1,
      ).allowStrangerMatch,
    ).toBe(true)
    expect(
      parseSnapshot({ roomId: 'room', multiRoomInfoDTO: {}, roomInfo: { roomBizType: 1 } }, 1)
        .allowStrangerMatch,
    ).toBeNull()
  })
})
