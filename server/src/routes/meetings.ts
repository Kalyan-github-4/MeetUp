import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { env } from "../config/env.ts";

import { issueGuestToken } from "../services/guest.ts";
import {
  closeRoom,
  createMeetingToken,
  removeFromRoom,
} from "../services/livekit.ts";
import {
  addParticipant,
  countActiveParticipants,
  createMeeting,
  endMeeting,
  endSession,
  findActiveParticipantForUser,
  findParticipantById,
  getMeetingByCode,
  getOrCreateActiveSession,
  listActiveParticipants,
  listMeetingsForHost,
  listOpenSessions,
  listWaitingParticipants,
  markParticipantLeft,
  setParticipantStatus,
  type MeetingSession,
  type Participant,
} from "../services/meetings.ts";
import {
  createMessage,
  listMessagesForSession,
  purgeMessagesForSession,
} from "../services/messages.ts";

const createBody = z.object({
  // Optional: starting a meeting should be one click. A title can be added
  // later; until then the host's name stands in.
  title: z.string().trim().min(1).max(120).optional(),
  scheduledAt: z.coerce.date().optional(),
});

const joinBody = z.object({
  displayName: z.string().trim().min(1).max(60).optional(),
});

/** Used when a host starts a meeting without naming it. */
function defaultTitle(hostName: string | null): string {
  const first = hostName?.trim().split(/\s+/)[0];
  return first ? `${first}'s meeting` : "Instant meeting";
}

const codeParams = z.object({
  code: z.string().trim().min(1).max(40),
});

const participantParams = codeParams.extend({
  participantId: z.string().uuid(),
  action: z.enum(["admit", "deny", "remove"]),
});

const messageBody = z.object({
  // The sender allocates the id so the stored row and the copy already
  // delivered over the data channel share a key — see `createMessage`.
  id: z.string().uuid(),
  body: z.string().trim().min(1).max(2000),
});

/**
 * The caller's seat in a session, or null if they hold none.
 *
 * The participant row is re-read from the database rather than trusted from the
 * request, so a token can only ever grant the seat it was issued for. Every
 * route that acts inside a meeting goes through here.
 */
async function resolveSeat(
  request: { guest: { participantId: string } | null; user: { id: string } | null },
  session: MeetingSession,
): Promise<{ participant: Participant } | { error: string }> {
  const participant = request.guest
    ? await findParticipantById(request.guest.participantId)
    : request.user
      ? await findActiveParticipantForUser(session.id, request.user.id)
      : null;

  if (!participant) return { error: "Join the meeting first" };

  // A seat in one session must not open another.
  if (participant.sessionId !== session.id) {
    return { error: "That seat is for a previous session" };
  }

  if (participant.leftAt) return { error: "You have left this meeting" };

  return { participant };
}

/**
 * Why a seat that exists still cannot enter the call, or null if it can.
 *
 * The `reason` travels to the client so it can tell "keep waiting" apart from
 * "you were turned away" without parsing a sentence.
 */
function admissionError(
  participant: Participant,
): { error: string; reason: "waiting" | "denied" } | null {
  if (participant.status === "waiting") {
    return { error: "Waiting for the host to let you in", reason: "waiting" };
  }
  if (participant.status === "denied") {
    return { error: "The host did not let you in", reason: "denied" };
  }
  return null;
}

/**
 * Ends a session once nobody is left in it, and drops its chat.
 *
 * Chat is not kept beyond the call, and a host closing their tab is a far more
 * common ending than one pressing End — so the last person out is what actually
 * triggers cleanup for most meetings.
 */
async function closeSessionIfEmpty(session: MeetingSession): Promise<void> {
  if ((await countActiveParticipants(session.id)) > 0) return;

  await endSession(session);
  await purgeMessagesForSession(session.id);
}

function publicMeeting(meeting: Awaited<ReturnType<typeof getMeetingByCode>>) {
  if (!meeting) return null;
  return {
    id: meeting.id,
    code: meeting.code,
    title: meeting.title,
    status: meeting.status,
    scheduledAt: meeting.scheduledAt,
    host: { id: meeting.host.id, name: meeting.host.name },
  };
}

export async function meetingRoutes(app: FastifyInstance): Promise<void> {
  app.post("/meetings", { preHandler: app.requireAuth }, async (request, reply) => {
    const parsed = createBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Invalid request", issues: parsed.error.issues });
    }

    const meeting = await createMeeting({
      hostId: request.user!.id,
      title: parsed.data.title ?? defaultTitle(request.user!.name),
      scheduledAt: parsed.data.scheduledAt ?? null,
    });

    return reply.code(201).send({
      id: meeting.id,
      code: meeting.code,
      title: meeting.title,
      status: meeting.status,
      scheduledAt: meeting.scheduledAt,
      createdAt: meeting.createdAt,
    });
  });

  app.get("/meetings", { preHandler: app.requireAuth }, async (request) => {
    const meetings = await listMeetingsForHost(request.user!.id);
    return { meetings };
  });

  // Public so the pre-join screen can show what a guest is about to join.
  app.get("/meetings/:code", async (request, reply) => {
    const params = codeParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid code" });

    const meeting = await getMeetingByCode(params.data.code);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });

    return publicMeeting(meeting);
  });

  app.post("/meetings/:code/join", async (request, reply) => {
    const params = codeParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid code" });

    const body = joinBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid request", issues: body.error.issues });
    }

    const meeting = await getMeetingByCode(params.data.code);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });
    if (meeting.status === "ended") {
      return reply.code(409).send({ error: "This meeting has ended" });
    }

    const user = request.user;
    const displayName = user?.name ?? body.data.displayName ?? null;
    if (!displayName) {
      // A guest has no profile to fall back on.
      return reply.code(400).send({ error: "displayName is required for guests" });
    }

    const session = await getOrCreateActiveSession(meeting);
    const isHost = user !== null && user.id === meeting.hostId;
    const participant = await addParticipant({
      sessionId: session.id,
      userId: user?.id ?? null,
      displayName,
      role: isHost ? "host" : "guest",
      // Everyone but the host knocks. The host is the only one who can open
      // the door, so they must never be left standing outside it.
      status: isHost ? "admitted" : "waiting",
    });

    return reply.code(201).send({
      meeting: publicMeeting(meeting),
      session: { id: session.id, livekitRoom: session.livekitRoom },
      participant: {
        id: participant.id,
        displayName: participant.displayName,
        role: participant.role,
        status: participant.status,
      },
      // Guests get a token so a reload keeps them as the same participant.
      guestToken: user
        ? null
        : issueGuestToken({ participantId: participant.id, sessionId: session.id }),
    });
  });

  /**
   * Issues the LiveKit token that actually admits someone to the call.
   *
   * The caller proves who they are with a Clerk or guest token; the participant
   * row is then re-read from the database rather than trusted from the request,
   * so a token can only ever grant the seat it was issued for.
   */
  app.post("/meetings/:code/token", async (request, reply) => {
    const params = codeParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid code" });

    const meeting = await getMeetingByCode(params.data.code);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });
    if (meeting.status === "ended") {
      return reply.code(409).send({ error: "This meeting has ended" });
    }

    const session = await getOrCreateActiveSession(meeting);

    const seat = await resolveSeat(request, session);
    if ("error" in seat) return reply.code(403).send({ error: seat.error });
    const { participant } = seat;

    // A knocking guest polls this route; it is what opens once they are let in.
    const blocked = admissionError(participant);
    if (blocked) return reply.code(403).send(blocked);

    const token = await createMeetingToken({
      room: session.livekitRoom,
      identity: participant.id,
      displayName: participant.displayName,
      canPublish: true,
    });

    return {
      token,
      url: env.LIVEKIT_URL,
      room: session.livekitRoom,
      participant: {
        id: participant.id,
        displayName: participant.displayName,
        role: participant.role,
      },
    };
  });

  app.get("/meetings/:code/participants", async (request, reply) => {
    const params = codeParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid code" });

    const meeting = await getMeetingByCode(params.data.code);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });

    const session = await getOrCreateActiveSession(meeting);
    const active = await listActiveParticipants(session.id);

    return {
      participants: active.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        role: p.role,
        joinedAt: p.joinedAt,
      })),
    };
  });

  /**
   * The chat backlog for the session in progress.
   *
   * LiveKit's data channel only reaches participants who are already connected,
   * so without this anyone joining late — or simply reloading — would see an
   * empty panel while everyone else sees the conversation.
   */
  app.get("/meetings/:code/messages", async (request, reply) => {
    const params = codeParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid code" });

    const meeting = await getMeetingByCode(params.data.code);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });

    const session = await getOrCreateActiveSession(meeting);

    // Only someone in the call may read the room's chat — not someone still
    // waiting to be let in.
    const seat = await resolveSeat(request, session);
    if ("error" in seat) return reply.code(403).send({ error: seat.error });
    const blocked = admissionError(seat.participant);
    if (blocked) return reply.code(403).send(blocked);

    const stored = await listMessagesForSession(session.id);

    return {
      messages: stored.map((message) => ({
        id: message.id,
        authorId: message.participantId,
        authorName: message.authorName,
        body: message.body,
        sentAt: message.sentAt,
      })),
    };
  });

  /**
   * Stores a message that has already been broadcast over the data channel.
   *
   * Delivery and persistence are deliberately separate: chat appears instantly
   * because LiveKit carried it, and this call only decides whether a later
   * joiner will see it too. A failure here therefore costs the backlog, never
   * the conversation.
   */
  app.post("/meetings/:code/messages", async (request, reply) => {
    const params = codeParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid code" });

    const body = messageBody.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.code(400).send({ error: "Invalid request", issues: body.error.issues });
    }

    const meeting = await getMeetingByCode(params.data.code);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });

    const session = await getOrCreateActiveSession(meeting);

    const seat = await resolveSeat(request, session);
    if ("error" in seat) return reply.code(403).send({ error: seat.error });
    const { participant } = seat;
    const blocked = admissionError(participant);
    if (blocked) return reply.code(403).send(blocked);

    // The author is the caller's own seat, never a name from the body —
    // otherwise anyone could post as anyone.
    const message = await createMessage({
      id: body.data.id,
      sessionId: session.id,
      participantId: participant.id,
      authorName: participant.displayName,
      body: body.data.body,
    });

    // A null return means this id was already stored — a retried POST.
    if (!message) return reply.code(204).send();

    return reply.code(201).send({
      id: message.id,
      authorId: message.participantId,
      authorName: message.authorName,
      body: message.body,
      sentAt: message.sentAt,
    });
  });

  app.post("/meetings/:code/leave", async (request, reply) => {
    const params = codeParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid code" });

    const meeting = await getMeetingByCode(params.data.code);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });

    // Never start a session on the way out — read the open one, if any.
    const [session] = await listOpenSessions(meeting.id);
    if (!session) return reply.code(204).send();

    // Who is leaving comes from the caller's own token, never from the body —
    // otherwise anyone could evict anyone else by guessing a participant id.
    // Leaving is idempotent: a caller with no seat has nothing to do.
    const seat = await resolveSeat(request, session);
    if ("error" in seat) return reply.code(204).send();

    await markParticipantLeft(seat.participant.id);
    // Someone giving up at the door never ends the call. Without this check a
    // guest who arrived before the host, and left, would close the meeting
    // before it began.
    if (seat.participant.status === "admitted") await closeSessionIfEmpty(session);

    return reply.code(204).send();
  });

  app.post("/meetings/:code/end", { preHandler: app.requireAuth }, async (request, reply) => {
    const params = codeParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid code" });

    const meeting = await getMeetingByCode(params.data.code);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });

    // Only the host may end a meeting for everyone.
    if (meeting.hostId !== request.user!.id) {
      return reply.code(403).send({ error: "Only the host can end this meeting" });
    }

    const open = await listOpenSessions(meeting.id);
    await endMeeting(meeting.id);
    for (const session of open) {
      await purgeMessagesForSession(session.id);
      // The database already says the meeting is over, so nobody can get back
      // in; this is what actually disconnects the people still in the call.
      try {
        await closeRoom(session.livekitRoom);
      } catch (error) {
        request.log.error({ err: error, room: session.livekitRoom }, "failed to close LiveKit room");
      }
    }

    return reply.code(204).send();
  });

  /**
   * The people knocking, for the host's admit/deny prompt.
   *
   * Polled by the host's browser. A waiting guest holds no LiveKit token, so
   * there is no room event to push this over — and a few seconds of latency on
   * a knock is what every waiting room has anyway.
   */
  app.get("/meetings/:code/waiting", { preHandler: app.requireAuth }, async (request, reply) => {
    const params = codeParams.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid code" });

    const meeting = await getMeetingByCode(params.data.code);
    if (!meeting) return reply.code(404).send({ error: "Meeting not found" });
    if (meeting.hostId !== request.user!.id) {
      return reply.code(403).send({ error: "Only the host can see who is waiting" });
    }

    const [session] = await listOpenSessions(meeting.id);
    const waiting = session ? await listWaitingParticipants(session.id) : [];

    return {
      participants: waiting.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        joinedAt: p.joinedAt,
      })),
    };
  });

  /**
   * The host's controls over one seat: let in or turn away someone waiting,
   * and remove someone from the call.
   *
   * There is no control over a microphone here: a mic belongs to the person
   * sitting behind it.
   */
  app.post(
    "/meetings/:code/participants/:participantId/:action",
    { preHandler: app.requireAuth },
    async (request, reply) => {
      const params = participantParams.safeParse(request.params);
      if (!params.success) return reply.code(400).send({ error: "Invalid request" });
      const { code, participantId, action } = params.data;

      const meeting = await getMeetingByCode(code);
      if (!meeting) return reply.code(404).send({ error: "Meeting not found" });
      if (meeting.hostId !== request.user!.id) {
        return reply.code(403).send({ error: "Only the host can do that" });
      }

      const [session] = await listOpenSessions(meeting.id);
      const target = await findParticipantById(participantId);

      // The seat must belong to the call running now, so an id from a past
      // session cannot be used to act on anything.
      if (!session || !target || target.sessionId !== session.id || target.leftAt) {
        return reply.code(404).send({ error: "That person is not in this meeting" });
      }
      if (target.role === "host") {
        return reply.code(400).send({ error: "The host cannot be moderated" });
      }

      if (action === "admit" || action === "deny") {
        if (target.status !== "waiting") {
          return reply.code(409).send({ error: "That person is not waiting" });
        }
        await setParticipantStatus(target.id, action === "admit" ? "admitted" : "denied");
        return reply.code(204).send();
      }

      if (target.status !== "admitted") {
        return reply.code(409).send({ error: "That person is not in the call" });
      }

      // Recorded before the disconnect, so the removed browser's attempt to
      // reconnect finds its seat already closed.
      await setParticipantStatus(target.id, "removed");
      await removeFromRoom(session.livekitRoom, target.id);
      await closeSessionIfEmpty(session);
      return reply.code(204).send();
    },
  );
}
