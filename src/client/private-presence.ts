import type { PartyController } from './controller'
import type { PrivatePeer } from '../shared/private-notices'

// src/client/private-presence.ts
export const PRIVATE_PRESENCE_TTL = 45_000
const RETRY_DELAY = 30_000
const CACHE_LIMIT = 256
export const PRIVATE_PRESENCE_ROUND_LIMIT = CACHE_LIMIT
type Controller = Pick<PartyController, 'state' | 'connection' | 'subscribe' | 'handleAccountError'>
type Watcher = { peers(): readonly string[]; active(): boolean; changed(): void }
type Entry = { peer: PrivatePeer; expires: number }

/** One account cache serves all visible inboxes; presence is never inferred from IM connectivity. */
export class PrivatePresence {
  private cache = new Map<string, Entry>()
  private pending = new Set<string>()
  private watchers = new Set<Watcher>()
  private account = ''
  private epoch = 0
  private roundStart = -Infinity
  private roundRequests = 0
  private cursor = 0
  private timer: ReturnType<typeof setTimeout> | undefined
  private stopAccount: (() => void) | undefined
  private readonly doc: EventTarget
  private readonly win: EventTarget
  private readonly foreground: () => boolean

  constructor(
    private controller: Controller,
    environment?: { document: EventTarget; window: EventTarget; foreground(): boolean },
  ) {
    this.doc = environment?.document ?? document
    this.win = environment?.window ?? window
    this.foreground =
      environment?.foreground ??
      (() => document.visibilityState === 'visible' && document.hasFocus())
  }

  get(uid: string): PrivatePeer | undefined {
    this.checkAccount()
    return this.cache.get(uid)?.peer
  }

  watch(watcher: Watcher) {
    if (!this.watchers.size) {
      this.stopAccount = this.controller.subscribe(() => {
        if (this.checkAccount()) this.refresh()
      })
      this.doc.addEventListener('visibilitychange', this.refresh)
      this.win.addEventListener('focus', this.refresh)
      this.win.addEventListener('blur', this.refresh)
      this.win.addEventListener('online', this.refresh)
      this.win.addEventListener('resize', this.refresh)
    }
    this.watchers.add(watcher)
    this.checkAccount()
    this.refresh()
    return {
      refresh: this.refresh,
      dispose: () => {
        this.watchers.delete(watcher)
        if (this.watchers.size) return this.refresh()
        clearTimeout(this.timer)
        this.timer = undefined
        this.stopAccount?.()
        this.stopAccount = undefined
        this.doc.removeEventListener('visibilitychange', this.refresh)
        this.win.removeEventListener('focus', this.refresh)
        this.win.removeEventListener('blur', this.refresh)
        this.win.removeEventListener('online', this.refresh)
        this.win.removeEventListener('resize', this.refresh)
        // A later mount may reuse fresh cached metadata, but not responses from a closed view.
        this.epoch++
        this.pending.clear()
      },
    }
  }

  private changed() {
    for (const watcher of this.watchers) {
      try {
        watcher.changed()
      } catch {}
    }
  }

  private checkAccount() {
    const next = this.controller.state.account?.uid ?? ''
    if (this.account === next) return false
    this.account = next
    this.epoch++
    this.cache.clear()
    this.pending.clear()
    this.roundStart = -Infinity
    this.roundRequests = this.cursor = 0
    this.changed()
    return true
  }

  private refresh = () => {
    clearTimeout(this.timer)
    this.timer = undefined
    if (this.watchers.size) this.timer = setTimeout(() => this.pump(), 0)
  }

  private pump() {
    this.timer = undefined
    this.checkAccount()
    if (!this.account || !this.watchers.size || !this.foreground()) return
    const peers = new Set<string>()
    for (const watcher of this.watchers) {
      if (!watcher.active()) continue
      for (const uid of watcher.peers()) if (/^[1-9]\d{0,23}$/.test(uid)) peers.add(uid)
    }
    const now = Date.now()
    if (now - this.roundStart >= PRIVATE_PRESENCE_TTL) {
      this.roundStart = now
      this.roundRequests = 0
    }
    const candidates = [...peers],
      start = this.cursor % (candidates.length || 1)
    let next = Infinity
    for (let offset = 0; offset < candidates.length; offset++) {
      const index = (start + offset) % candidates.length,
        uid = candidates[index]
      const expires = this.cache.get(uid)?.expires ?? 0
      if (expires > now) next = Math.min(next, expires - now)
      else if (!this.pending.has(uid)) {
        if (this.roundRequests >= PRIVATE_PRESENCE_ROUND_LIMIT)
          next = Math.min(next, this.roundStart + PRIVATE_PRESENCE_TTL - now)
        else if (this.pending.size < 2) {
          this.roundRequests++
          this.cursor = (index + 1) % candidates.length
          void this.load(uid, this.epoch)
        }
      }
    }
    if (Number.isFinite(next)) this.timer = setTimeout(() => this.pump(), next)
  }

  private async load(uid: string, epoch: number) {
    this.pending.add(uid)
    let peer: PrivatePeer,
      expires = Date.now() + PRIVATE_PRESENCE_TTL
    try {
      peer = await this.controller.connection.privatePeer(uid)
      if (epoch !== this.epoch) return
      // Never promote a missing/non-boolean state to an online indicator.
      peer = { ...peer, uid, online: typeof peer.online === 'boolean' ? peer.online : null }
      expires = Date.now() + PRIVATE_PRESENCE_TTL
    } catch (error) {
      if (epoch !== this.epoch) return
      this.controller.handleAccountError(error as { code?: number })
      if (epoch !== this.epoch) return
      const previous = this.cache.get(uid)?.peer
      peer = {
        uid,
        nickname: previous?.nickname ?? '',
        avatar: previous?.avatar ?? '',
        online: null,
      }
      expires = Date.now() + RETRY_DELAY
    } finally {
      if (epoch === this.epoch) this.pending.delete(uid)
    }
    if (epoch !== this.epoch) return
    const previous = this.cache.get(uid)?.peer
    this.cache.delete(uid)
    this.cache.set(uid, { peer, expires })
    if (this.cache.size > CACHE_LIMIT) this.cache.delete(this.cache.keys().next().value!)
    if (
      !previous ||
      previous.online !== peer.online ||
      previous.nickname !== peer.nickname ||
      previous.avatar !== peer.avatar
    )
      this.changed()
    this.refresh()
  }
}

const services = new WeakMap<PartyController, PrivatePresence>()
export function getPrivatePresence(controller: PartyController): PrivatePresence {
  let service = services.get(controller)
  if (!service) {
    service = new PrivatePresence(controller)
    services.set(controller, service)
  }
  return service
}
