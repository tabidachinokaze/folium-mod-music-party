import { describe, expect, it } from 'vitest'
import type { Conversation } from '@party/shared/types'
import { orderPrivateContacts } from '../src/client/private-contacts'

const peer = (uid: string, time: number): Conversation => ({
  uid,
  time,
  nickname: uid,
  avatar: '',
  preview: '',
  unread: 0,
})

describe('online-first private contacts', () => {
  it('promotes only confirmed-online users, preserving newest-message order within each group', () => {
    const values = [peer('1', 400), peer('2', 300), peer('3', 200), peer('4', 100)]
    const states = new Map<string, boolean | null>([
      ['1', false],
      ['2', true],
      ['3', null],
      ['4', true],
    ])
    expect(
      orderPrivateContacts(values, (uid) => states.get(uid)).map((value) => value.uid),
    ).toEqual(['2', '4', '1', '3'])
    expect(values.map((value) => value.uid)).toEqual(['1', '2', '3', '4'])
  })

  it('keeps offline and unknown users in a single time-sorted group, with stable ties', () => {
    const values = [peer('1', 200), peer('2', 300), peer('3', 300), peer('4', 100)]
    expect(
      orderPrivateContacts(values, (uid) => (uid === '2' ? false : undefined)).map(
        (value) => value.uid,
      ),
    ).toEqual(['2', '3', '1', '4'])
  })

  it('moves a previously offscreen peer online and restores time ordering after it goes offline', () => {
    const values = [peer('1', 300), peer('2', 200), peer('3', 100)]
    expect(orderPrivateContacts(values, (uid) => uid === '3').map((value) => value.uid)).toEqual([
      '3',
      '1',
      '2',
    ])
    expect(orderPrivateContacts(values, () => false).map((value) => value.uid)).toEqual([
      '1',
      '2',
      '3',
    ])
  })
})
