/**
 * This browser's seat in a meeting, kept in localStorage.
 *
 * Deliberately a plain module rather than living beside the components: a file
 * carrying "use client" that a server component imports becomes a client entry,
 * and its non-component exports are not reachable from other client modules.
 */

export type StoredParticipant = {
  participantId: string
  displayName: string
  guestToken: string | null
}

function storageKey(code: string): string {
  return `meetup:participant:${code}`
}

export function readParticipant(code: string): StoredParticipant | null {
  try {
    const raw = window.localStorage.getItem(storageKey(code))
    return raw ? (JSON.parse(raw) as StoredParticipant) : null
  } catch {
    return null
  }
}

export function saveParticipant(
  code: string,
  participant: StoredParticipant,
): void {
  try {
    window.localStorage.setItem(storageKey(code), JSON.stringify(participant))
  } catch {
    // Storage unavailable (private mode) — the seat just will not survive a
    // reload, which is better than failing the join.
  }
  notifyStoreChanged()
}

/** Forgets this browser's seat, sending the gate back to the join screen. */
export function clearParticipant(code: string): void {
  try {
    window.localStorage.removeItem(storageKey(code))
  } catch {
    // Nothing to clear if storage is unavailable.
  }
  notifyStoreChanged()
}

// localStorage is an external store, so components subscribe to it rather than
// mirroring it into state from an effect. Writes in this tab notify directly;
// the `storage` event covers the same meeting open in another tab.
const listeners = new Set<() => void>()

export function subscribeToSeat(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange)
  window.addEventListener("storage", onStoreChange)

  return () => {
    listeners.delete(onStoreChange)
    window.removeEventListener("storage", onStoreChange)
  }
}

export function notifyStoreChanged(): void {
  for (const listener of listeners) listener()
}
