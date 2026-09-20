const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

export type MeetingToken = {
  token: string
  url: string
  room: string
  participant: { id: string; displayName: string; role: string }
}

/**
 * Why the API would not hand over a token. `reason` is set when the seat is
 * still at the door (`waiting`) or was turned away (`denied`); `status` tells a
 * meeting that has ended (409) apart from a seat that is no longer valid (403).
 */
export class MeetingAccessError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly reason: "waiting" | "denied" | null,
  ) {
    super(message)
    this.name = "MeetingAccessError"
  }
}

function authHeaders(authToken: string | null): HeadersInit {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {}
}

async function errorFrom(response: Response, fallback: string): Promise<MeetingAccessError> {
  const body = (await response.json().catch(() => null)) as {
    error?: string
    reason?: "waiting" | "denied"
  } | null
  return new MeetingAccessError(
    body?.error ?? fallback,
    response.status,
    body?.reason ?? null,
  )
}

/**
 * Exchanges this browser's seat for a LiveKit token.
 *
 * Guests authenticate with the token they were given when joining; signed-in
 * users are recognised by their Clerk session, which the API reads from the
 * Authorization header the caller supplies.
 */
export async function fetchMeetingToken(
  code: string,
  authToken: string | null,
): Promise<MeetingToken> {
  const response = await fetch(
    `${API_URL}/meetings/${encodeURIComponent(code)}/token`,
    {
      method: "POST",
      headers: authHeaders(authToken),
    },
  )

  if (!response.ok) {
    throw await errorFrom(response, "Could not connect to the meeting.")
  }

  return (await response.json()) as MeetingToken
}

/**
 * Releases this browser's seat.
 *
 * Best effort by design: a tab closed without warning never gets here, so the
 * API also treats a leave as idempotent and nothing depends on this call having
 * succeeded. What it buys is an accurate participant list — and, when the last
 * person leaves, the end of the session and the deletion of its chat.
 */
export async function leaveMeeting(
  code: string,
  authToken: string | null,
): Promise<void> {
  await fetch(`${API_URL}/meetings/${encodeURIComponent(code)}/leave`, {
    method: "POST",
    headers: authHeaders(authToken),
    keepalive: true,
  })
}

/** Ends the meeting for everyone. Host only; the API closes the LiveKit room. */
export async function endMeetingForAll(
  code: string,
  authToken: string | null,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/meetings/${encodeURIComponent(code)}/end`,
    { method: "POST", headers: authHeaders(authToken) },
  )
  if (!response.ok) {
    throw await errorFrom(response, "Could not end the meeting.")
  }
}

export type WaitingParticipant = {
  id: string
  displayName: string
  joinedAt: string
}

/** Who is knocking. Host only. */
export async function fetchWaiting(
  code: string,
  authToken: string | null,
): Promise<WaitingParticipant[]> {
  const response = await fetch(
    `${API_URL}/meetings/${encodeURIComponent(code)}/waiting`,
    { headers: authHeaders(authToken) },
  )
  if (!response.ok) {
    throw await errorFrom(response, "Could not load the waiting room.")
  }
  const { participants } = (await response.json()) as {
    participants: WaitingParticipant[]
  }
  return participants
}

export type ModerationAction = "admit" | "deny" | "remove"

/** One host action on one seat. `participantId` is the LiveKit identity. */
export async function moderateParticipant(
  code: string,
  participantId: string,
  action: ModerationAction,
  authToken: string | null,
): Promise<void> {
  const response = await fetch(
    `${API_URL}/meetings/${encodeURIComponent(code)}/participants/${encodeURIComponent(participantId)}/${action}`,
    { method: "POST", headers: authHeaders(authToken) },
  )
  if (!response.ok) {
    throw await errorFrom(response, "That did not work. Try again.")
  }
}
