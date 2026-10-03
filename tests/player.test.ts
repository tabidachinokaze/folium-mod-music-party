import { afterEach, describe, expect, it, vi } from 'vitest'
import { RoomPlayer } from '../src/client/player'
import { fakeHost, snapshot, song } from './fixtures'

// tests/player.test.ts
afterEach(() => vi.useRealTimers())
describe('room playback', () => {
  it('loads through Folia, converts milliseconds to seconds and rejects older snapshots', async () => {
    const host = fakeHost(),
      player = new RoomPlayer(host.folium, host.bridge, () => 2000)
    player.start(() => {})
    await player.apply(snapshot())
    expect(host.lease.seek).toHaveBeenLastCalledWith(21)
    expect(host.folium.playback.play).toHaveBeenCalledTimes(1)
    await player.apply(snapshot('2', 0))
    expect(host.lease.play).toHaveBeenCalledTimes(1)
    player.dispose()
  })
  it('does not play an old resolve after leaving, or after a newer song overtakes it', async () => {
    const host = fakeHost(),
      player = new RoomPlayer(host.folium, host.bridge)
    let resolve!: (value: ReturnType<typeof song>) => void
    host.bridge.resolveSong.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    player.start(() => {})
    const pending = player.apply(snapshot())
    await player.apply(snapshot('2', 2, 2000))
    resolve(song('1'))
    await pending
    expect(host.lease.play.mock.calls.map((call) => call[0].id)).toEqual(['2'])
    player.stop()
    expect(host.lease.release).toHaveBeenCalledTimes(1)
    player.dispose()
  })
  it('keeps local pause across a remote song change and resynchronizes on resume', async () => {
    const host = fakeHost(),
      player = new RoomPlayer(host.folium, host.bridge, () => 2000)
    player.start(() => {})
    await player.apply(snapshot())
    host.folium.playback.pause()
    await player.apply(snapshot('2', 2))
    expect(host.state.state).toBe('paused')
    host.folium.playback.play()
    expect(host.lease.seek).toHaveBeenLastCalledWith(21)
    player.dispose()
  })
  it('does not restart an ended business item and resumes after a transient disconnect', async () => {
    const host = fakeHost(),
      player = new RoomPlayer(host.folium, host.bridge, () => 2000)
    player.start(() => {})
    await player.apply(snapshot())
    player.suspend()
    await player.apply(snapshot())
    expect(host.state.state).toBe('playing')
    player.ended()
    host.state.state = 'stopped'
    await player.apply(snapshot())
    expect(host.state.state).toBe('stopped')
    player.dispose()
  })
  it('retains a pause clicked during an unfinished load', async () => {
    const host = fakeHost(),
      player = new RoomPlayer(host.folium, host.bridge)
    let resolve!: (value: ReturnType<typeof song>) => void
    host.bridge.resolveSong.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    player.start(() => {})
    const pending = player.apply(snapshot())
    host.folium.playback.pause()
    resolve(song())
    await pending
    expect(host.folium.playback.play).not.toHaveBeenCalled()
    player.dispose()
  })
  it('waits for a new source commit when the same song occurs twice in the room queue', async () => {
    const host = fakeHost(),
      player = new RoomPlayer(host.folium, host.bridge)
    player.start(() => {})
    await player.apply(snapshot())
    let ready!: () => void
    host.lease.play.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          ready = () => resolve({ status: 'source-committed' })
        }),
    )
    vi.mocked(host.folium.playback.play).mockClear()
    const second = player.apply(snapshot('1', 2, 2000))
    await Promise.resolve()
    await Promise.resolve()
    expect(host.folium.playback.play).not.toHaveBeenCalled()
    ready()
    await second
    expect(host.folium.playback.play).toHaveBeenCalledTimes(1)
    player.dispose()
  })
  it('never starts a pending load after the connection is suspended', async () => {
    const host = fakeHost(),
      player = new RoomPlayer(host.folium, host.bridge)
    let resolve!: (value: ReturnType<typeof song>) => void
    host.bridge.resolveSong.mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done
        }),
    )
    player.start(() => {})
    const pending = player.apply(snapshot())
    player.suspend()
    resolve(song())
    await pending
    expect(host.folium.playback.play).not.toHaveBeenCalled()
    await player.apply(snapshot())
    expect(host.folium.playback.play).toHaveBeenCalledTimes(1)
    player.dispose()
  })
  it('does not wait for metadata or resume after a cancelled source request', async () => {
    const host = fakeHost(),
      report = vi.fn()
    host.lease.play.mockResolvedValueOnce({ status: 'cancelled' })
    const player = new RoomPlayer(host.folium, host.bridge, () => 2000, report)
    player.start(() => {})
    await player.apply(snapshot())
    expect(host.folium.playback.play).not.toHaveBeenCalled()
    expect(host.lease.seek).not.toHaveBeenCalled()
    expect(report).not.toHaveBeenCalled()
    player.dispose()
  })
  it('reports an unavailable source without a metadata timeout', async () => {
    const host = fakeHost(),
      report = vi.fn()
    host.lease.play.mockResolvedValueOnce({ status: 'unavailable' })
    const player = new RoomPlayer(host.folium, host.bridge, () => 2000, report)
    player.start(() => {})
    await player.apply(snapshot())
    expect(report).toHaveBeenCalledWith(expect.stringContaining('不可用'))
    expect(host.folium.playback.play).not.toHaveBeenCalled()
    player.dispose()
  })
})

it('hands off the current song without reloading, seeking or changing pause state', async () => {
  const host = fakeHost(),
    player = new RoomPlayer(host.folium, host.bridge, () => 2000)
  player.start(() => {})
  await player.apply(snapshot())
  host.folium.playback.pause()
  host.lease.play.mockClear()
  host.lease.seek.mockClear()
  player.stop(true)
  expect(host.lease.handoff).toHaveBeenCalledTimes(1)
  expect(host.lease.release).not.toHaveBeenCalled()
  expect(host.state.state).toBe('paused')
  expect(host.lease.play).not.toHaveBeenCalled()
  expect(host.lease.seek).not.toHaveBeenCalled()
  player.dispose()
})

it('auditions locally while caching room changes, then returns to the newest room position', async () => {
  const host = fakeHost(),
    active = vi.fn()
  const player = new RoomPlayer(host.folium, host.bridge, () => 3000, vi.fn(), vi.fn(), active)
  player.start(() => {})
  await player.apply(snapshot())
  await player.audition(song('audition'))
  expect(active).toHaveBeenLastCalledWith(true)
  host.lease.seek.mockClear()
  await player.apply(snapshot('2', 2, 2000))
  player.align(true)
  expect(host.state.song?.id).toBe('audition')
  expect(host.lease.seek).not.toHaveBeenCalled()
  expect(host.lease.release).not.toHaveBeenCalled()
  await player.returnToRoom()
  expect(host.state.song?.id).toBe('2')
  expect(host.lease.seek).toHaveBeenLastCalledWith(21)
  expect(active).toHaveBeenLastCalledWith(false)
  expect(host.state.state).toBe('playing')
  player.dispose()
})

it('seeks and pauses an audition independently, preserving the prior room pause', async () => {
  const host = fakeHost(),
    player = new RoomPlayer(host.folium, host.bridge, () => 2000)
  player.start(() => {})
  await player.apply(snapshot())
  host.folium.playback.pause()
  await player.audition(song('audition'))
  expect(host.state.state).toBe('playing')
  player.seekAudition(42, false)
  expect(host.state.position).toBe(42)
  host.folium.playback.pause()
  await player.apply(snapshot('2', 2))
  expect(host.state.song?.id).toBe('audition')
  expect(host.state.state).toBe('paused')
  player.seekAudition(52, true)
  expect(host.state.state).toBe('playing')
  await player.returnToRoom()
  expect(host.state.song?.id).toBe('2')
  expect(host.state.state).toBe('paused')
  player.dispose()
})

it('returns after an unavailable audition without releasing room ownership', async () => {
  const host = fakeHost(),
    report = vi.fn()
  const player = new RoomPlayer(host.folium, host.bridge, () => 2000, report)
  player.start(() => {})
  await player.apply(snapshot())
  host.lease.play.mockResolvedValueOnce({ status: 'unavailable' })
  await player.audition(song('audition'))
  expect(player.auditioning).toBe(false)
  expect(report).toHaveBeenCalledWith(expect.stringContaining('试听'))
  expect(host.state.song?.id).toBe('1')
  expect(host.lease.release).not.toHaveBeenCalled()
  player.dispose()
})

it('does not interrupt audition on a room connection error or restore stale audio after leaving', async () => {
  const host = fakeHost(),
    player = new RoomPlayer(host.folium, host.bridge, () => 2000)
  player.start(() => {})
  await player.apply(snapshot())
  await player.audition(song('audition'))
  player.suspend()
  expect(host.state.state).toBe('playing')
  let complete!: () => void
  host.lease.play.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = () => resolve({ status: 'source-committed' })
      }),
  )
  const pending = player.audition(song('later'))
  player.stop(true)
  vi.mocked(host.folium.playback.play).mockClear()
  complete()
  await pending
  expect(host.folium.playback.play).not.toHaveBeenCalled()
  expect(player.auditioning).toBe(false)
  expect(host.lease.handoff).toHaveBeenCalledOnce()
  player.dispose()
})

it('returns to the room after a cancelled audition, and does not resume an audition paused during loading', async () => {
  const host = fakeHost(),
    player = new RoomPlayer(host.folium, host.bridge, () => 2000)
  player.start(() => {})
  await player.apply(snapshot())
  host.lease.play.mockResolvedValueOnce({ status: 'cancelled' })
  await player.audition(song('cancelled'))
  expect(player.auditioning).toBe(false)
  expect(host.state.song?.id).toBe('1')
  let complete!: () => void
  host.lease.play.mockImplementationOnce(
    (selected) =>
      new Promise((resolve) => {
        complete = () => {
          host.state.song = selected
          resolve({ status: 'source-committed' })
        }
      }),
  )
  const pending = player.audition(song('paused'))
  host.folium.playback.pause()
  complete()
  await pending
  expect(host.state.state).toBe('paused')
  await player.returnToRoom()
  expect(host.state.state).toBe('playing')
  player.dispose()
})

it('stops an unfinished audition source immediately before resolving the room source', async () => {
  const host = fakeHost(),
    player = new RoomPlayer(host.folium, host.bridge, () => 2000)
  player.start(() => {})
  await player.apply(snapshot())
  let auditionCommit!: () => void
  host.lease.play.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        auditionCommit = () => resolve({ status: 'cancelled' })
      }),
  )
  const audition = player.audition(song('pending'))
  let roomReady!: (value: ReturnType<typeof song>) => void
  host.bridge.resolveSong.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        roomReady = resolve
      }),
  )
  const stopped = player.returnToRoom()
  expect(host.lease.stop).toHaveBeenCalledOnce()
  expect(player.auditioning).toBe(false)
  expect(host.lease.release).not.toHaveBeenCalled()
  auditionCommit()
  await audition
  roomReady(song('1'))
  await stopped
  expect(host.state.song?.id).toBe('1')
  expect(host.state.state).toBe('playing')
  player.dispose()
})
