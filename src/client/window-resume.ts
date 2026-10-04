// src/client/window-resume.ts
// Only non-secret identity crosses a window recreation. The official status remains authoritative.
export interface WindowRoomResume {
  version: 1
  uid: string
  roomId: string
  listening: boolean
}
export function parseWindowRoomResume(value: unknown): WindowRoomResume | null {
  if (!value || typeof value !== 'object') return null
  const state = value as Partial<WindowRoomResume>
  if (
    state.version !== 1 ||
    typeof state.uid !== 'string' ||
    !/^[1-9]\d*$/.test(state.uid) ||
    typeof state.roomId !== 'string' ||
    !state.roomId ||
    state.roomId.length > 256 ||
    typeof state.listening !== 'boolean'
  )
    return null
  return { version: 1, uid: state.uid, roomId: state.roomId, listening: state.listening }
}
