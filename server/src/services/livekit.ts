import {
  AccessToken,
  RoomServiceClient,
  ServerError,
} from "livekit-server-sdk";

import { env } from "../config/env.ts";

const TOKEN_TTL = "2h";

/**
 * Mints a LiveKit access token scoped to a single room.
 *
 * The grant is deliberately narrow: a token names exactly one room, so it can
 * never be replayed against another meeting. `identity` must be the caller's
 * participant id — LiveKit treats it as the unique key for a seat, and reusing
 * one disconnects the earlier holder.
 */
export async function createMeetingToken(input: {
  room: string;
  identity: string;
  displayName: string;
  canPublish: boolean;
}): Promise<string> {
  const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: input.identity,
    name: input.displayName,
    ttl: TOKEN_TTL,
  });

  token.addGrant({
    room: input.room,
    roomJoin: true,
    canPublish: input.canPublish,
    canSubscribe: true,
    // Used for chat and reactions over LiveKit's data channel (Phase 5).
    canPublishData: true,
    // Lets a participant publish their own attributes — the stand-in figure
    // they picked before joining, so everyone else can render it. Scoped to
    // their own record; it grants nothing over anyone else's.
    canUpdateOwnMetadata: true,
  });

  return token.toJwt();
}

/**
 * Server-side control of running rooms. LiveKit's API is HTTP on the same host
 * the browsers reach over WebSocket, so the scheme is all that changes.
 */
const rooms = new RoomServiceClient(
  env.LIVEKIT_URL.replace(/^ws/, "http"),
  env.LIVEKIT_API_KEY,
  env.LIVEKIT_API_SECRET,
);

/** LiveKit answers "not found" once a room has emptied or a seat has gone. */
function isNotFound(error: unknown): boolean {
  return error instanceof ServerError && error.status === 404;
}

/**
 * Closes a room, disconnecting everyone in it. Their clients see the room
 * deleted, which is what lets them say "the host ended the meeting" rather
 * than "connection lost". A room that is already gone is not an error.
 */
export async function closeRoom(room: string): Promise<void> {
  try {
    await rooms.deleteRoom(room);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

/** Disconnects one participant. They can ask to come back through the door. */
export async function removeFromRoom(room: string, identity: string): Promise<void> {
  try {
    await rooms.removeParticipant(room, identity);
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

