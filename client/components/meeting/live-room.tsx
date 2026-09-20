"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@clerk/nextjs"
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useConnectionState,
  useLocalParticipant,
  useParticipants,
  useTracks,
} from "@livekit/components-react"
import {
  ConnectionError,
  ConnectionState,
  DisconnectReason,
  Track,
  type RoomOptions,
} from "livekit-client"

import { AVATAR_ATTRIBUTE, parseAvatarAttribute } from "@/lib/avatars"
import { HostControlsContext, useHostControls, type HostControls } from "@/lib/host-controls"
import {
  endMeetingForAll,
  fetchMeetingToken,
  fetchWaiting,
  leaveMeeting,
  MeetingAccessError,
  moderateParticipant,
  type MeetingToken,
  type WaitingParticipant,
} from "@/lib/livekit"
import { readMediaPrefs, type MediaPrefs } from "@/lib/media-prefs"
import { clearParticipant, readParticipant } from "@/lib/meeting-seat"
import { JoinRequest } from "@/components/meeting/join-request"
import { LiveControls, type RoomLayoutMode } from "@/components/meeting/live-controls"
import {
  LiveGrid,
  LiveParticipantStrip,
  LiveStage,
  type Tile,
} from "@/components/meeting/live-tiles"
import { MeetingHeader } from "@/components/meeting/meeting-header"

/**
 * Builds the tiles shown on stage and in the strip, and the flat list the grid
 * shows.
 *
 * A screen share takes the stage when present — that is what people are looking
 * at — otherwise the first remote camera does, falling back to the local one so
 * a lone participant still sees themselves.
 */
function useTiles(): { stage: Tile | null; strip: Tile[]; grid: Tile[] } {
  const participants = useParticipants()
  const tracks = useTracks(
    [Track.Source.Camera, Track.Source.ScreenShare],
    { onlySubscribed: false },
  )

  const cameraFor = (identity: string) =>
    tracks.find(
      (t) =>
        t.participant.identity === identity &&
        t.source === Track.Source.Camera &&
        t.publication?.isSubscribed !== false &&
        !t.publication?.isMuted,
    ) ?? null

  const tiles: Tile[] = participants.map((p) => ({
    id: p.identity,
    name: p.name || p.identity,
    isLocal: p.isLocal,
    micOn: p.isMicrophoneEnabled,
    isSpeaking: p.isSpeaking,
    avatar: parseAvatarAttribute(p.attributes?.[AVATAR_ATTRIBUTE]),
    video: cameraFor(p.identity),
  }))

  const screenShare = tracks.find((t) => t.source === Track.Source.ScreenShare)
  if (screenShare) {
    const owner = tiles.find(
      (t) => t.id === screenShare.participant.identity,
    )
    const screen: Tile = {
      id: `${screenShare.participant.identity}-screen`,
      name: `${owner?.name ?? "Someone"} — screen`,
      isLocal: screenShare.participant.isLocal,
      micOn: owner?.micOn ?? false,
      isSpeaking: false,
      avatar: owner?.avatar ?? null,
      video: screenShare,
      isScreen: true,
    }
    return { stage: screen, strip: tiles, grid: [screen, ...tiles] }
  }

  const speaking = tiles.find((t) => t.isSpeaking && !t.isLocal)
  const remote = tiles.find((t) => !t.isLocal)
  const stage = speaking ?? remote ?? tiles[0] ?? null

  return {
    stage,
    strip: tiles.filter((t) => t.id !== stage?.id),
    grid: tiles,
  }
}

/**
 * Publishes the figure this browser picked, once, on connect.
 *
 * The choice lives in the seat rather than on the server, so this is what
 * carries it to everyone else — without it the room would fall back to the
 * id-derived default and nobody would see what the picker chose.
 */
function AvatarAnnouncer({ code }: { code: string }) {
  const { localParticipant } = useLocalParticipant()

  useEffect(() => {
    const chosen = readParticipant(code)?.avatar
    if (chosen === undefined) return

    localParticipant
      .setAttributes({ [AVATAR_ATTRIBUTE]: String(chosen) })
      .catch(() => {
        // Cosmetic: everyone still sees a figure, just the default one.
      })
  }, [code, localParticipant])

  return null
}

/**
 * Keeps a note of whether mic and camera are on, so a rejoin after a dropped
 * connection restores the call as it was — never unmuting someone who had
 * muted themselves.
 */
function MediaStateTracker({
  onChange,
}: {
  onChange: (state: Pick<MediaPrefs, "micOn" | "camOn">) => void
}) {
  const { isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant()

  useEffect(() => {
    onChange({ micOn: isMicrophoneEnabled, camOn: isCameraEnabled })
  }, [isMicrophoneEnabled, isCameraEnabled, onChange])

  return null
}

/**
 * Shown while LiveKit repairs a dropped connection on its own. Most blips end
 * here; only when LiveKit gives up does the room hand over to a full rejoin.
 */
function ReconnectingBanner() {
  const state = useConnectionState()
  if (
    state !== ConnectionState.Reconnecting &&
    state !== ConnectionState.SignalReconnecting
  ) {
    return null
  }

  return (
    <p
      role="status"
      className="flex shrink-0 items-center justify-center gap-2 rounded-full border border-hairline px-4 py-2 text-sm text-ink-muted"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-ember" />
      Connection unstable — reconnecting…
    </p>
  )
}

const WAITING_POLL_MS = 3000

/**
 * The host's view of the door: everyone waiting, each with admit and deny.
 *
 * Polled, because a waiting guest holds no LiveKit token and so cannot announce
 * themselves through the room.
 */
function WaitingRoomRequests({ code }: { code: string }) {
  const { getToken } = useAuth()
  const { moderate } = useHostControls()
  const [waiting, setWaiting] = useState<WaitingParticipant[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setWaiting(await fetchWaiting(code, await getToken()))
    } catch {
      // The next poll will try again; a missed knock is only delayed.
    }
  }, [code, getToken])

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const list = await fetchWaiting(code, await getToken())
        if (!cancelled) setWaiting(list)
      } catch {
        // The next poll will try again; a missed knock is only delayed.
      }
    }

    void poll()
    const timer = window.setInterval(() => void poll(), WAITING_POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [code, getToken])

  async function answer(id: string, action: "admit" | "deny") {
    setBusy(id)
    setError(null)
    try {
      await moderate(id, action)
      // Gone from the list at once rather than on the next poll.
      setWaiting((current) => current.filter((p) => p.id !== id))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.")
      void refresh()
    } finally {
      setBusy(null)
    }
  }

  if (waiting.length === 0 && !error) return null

  return (
    <section aria-label="Waiting to join" className="flex shrink-0 flex-col gap-2">
      {waiting.map((p) => (
        <JoinRequest
          key={p.id}
          id={p.id}
          name={p.displayName}
          busy={busy === p.id}
          onAdmit={() => void answer(p.id, "admit")}
          onDeny={() => void answer(p.id, "deny")}
        />
      ))}
      {error ? (
        <p role="alert" className="text-xs text-ember">
          {error}
        </p>
      ) : null}
    </section>
  )
}

const LAYOUT_KEY = "meetup:layout"

function readLayout(): RoomLayoutMode {
  try {
    return window.localStorage.getItem(LAYOUT_KEY) === "grid" ? "grid" : "spotlight"
  } catch {
    return "spotlight"
  }
}

function RoomLayout({
  code,
  title,
  subtitle,
  sidePanels,
  isHost,
  onLeave,
  onEndForAll,
  onMediaChange,
}: {
  code: string
  title: string
  subtitle: string
  sidePanels: ReactNode
  isHost: boolean
  onLeave: () => void
  onEndForAll: () => Promise<void>
  onMediaChange: (state: Pick<MediaPrefs, "micOn" | "camOn">) => void
}) {
  const { stage, strip, grid } = useTiles()
  const { isMicrophoneEnabled } = useLocalParticipant()
  const [layout, setLayout] = useState<RoomLayoutMode>(readLayout)

  const changeLayout = useCallback((next: RoomLayoutMode) => {
    setLayout(next)
    try {
      window.localStorage.setItem(LAYOUT_KEY, next)
    } catch {
      // Not remembered, still applied.
    }
  }, [])

  const controls = (
    <LiveControls
      onLeave={onLeave}
      isHost={isHost}
      onEndForAll={onEndForAll}
      layout={layout}
      onLayoutChange={changeLayout}
    />
  )

  // `lg:basis-auto` below is what lets `lg:h-dvh` take effect: the room is a
  // flex item of the column in `body`, and a `flex-1` basis of 0 would
  // otherwise override the height and let the room grow with its content.
  return (
    <div className="flex flex-1 flex-col gap-5 bg-canvas p-5 text-ink lg:h-dvh lg:basis-auto lg:flex-row lg:overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <MeetingHeader title={title} subtitle={subtitle} code={code} />

        <ReconnectingBanner />
        {isHost ? <WaitingRoomRequests code={code} /> : null}

        <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
          {layout === "grid" ? (
            <LiveGrid tiles={grid}>{controls}</LiveGrid>
          ) : (
            <>
              <LiveParticipantStrip tiles={strip} />
              <LiveStage tile={stage}>{controls}</LiveStage>
            </>
          )}
        </div>

        <p className="text-center text-xs text-ink-muted">
          {isMicrophoneEnabled ? "Your mic is on" : "Your mic is muted"}
        </p>
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-4 lg:w-[360px] lg:overflow-y-auto">
        {sidePanels}
      </aside>

      <AvatarAnnouncer code={code} />
      <MediaStateTracker onChange={onMediaChange} />
      {/* Plays every remote audio track; without it the room is silent. */}
      <RoomAudioRenderer />
    </div>
  )
}

/**
 * What this browser is doing about the call.
 *
 * - `connecting`: asking for a token.
 * - `waiting`: at the door; the token request is repeated until the host
 *   answers.
 * - `live`: in the call.
 * - `lost`: the connection dropped and LiveKit gave up repairing it; the seat
 *   is kept and a fresh token is requested with backoff.
 * - `closed`: over for this browser, with a reason and a way onward.
 */
type Phase =
  | { kind: "connecting" }
  | { kind: "waiting" }
  | { kind: "live"; connection: MeetingToken }
  | { kind: "lost"; attempt: number }
  | {
      kind: "closed"
      heading: string
      detail: string
      /** `retry` keeps the seat; `ask-again` gives it up for the join form;
       *  `home` gives it up and leaves. */
      action: "retry" | "ask-again" | "home"
      retryLabel?: string
    }

/** Backoff for rejoining after a lost connection: 1s, 2s, 4s … capped at 15s. */
function retryDelay(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 15_000)
}

function Notice({
  eyebrow,
  heading,
  detail,
  children,
}: {
  eyebrow: string
  heading: string
  detail: string
  children?: ReactNode
}) {
  return (
    <main className="flex flex-1 items-center justify-center bg-canvas p-6 text-ink">
      <div className="w-full max-w-sm rounded-2xl border border-hairline p-8 text-center">
        <p className="flex items-center justify-center gap-2.5 text-xs tracking-[0.18em] text-ink-muted uppercase">
          <span className="size-2 rounded-full border border-ember" />
          {eyebrow}
        </p>
        <h1 className="mt-4 text-xl font-medium tracking-tight">{heading}</h1>
        <p className="mt-1.5 text-sm text-ink-muted">{detail}</p>
        {children ? (
          <div className="mt-6 flex flex-col gap-2">{children}</div>
        ) : null}
      </div>
    </main>
  )
}

const primaryButton =
  "flex h-11 w-full items-center justify-center rounded-full bg-ink text-sm font-medium text-canvas transition-opacity hover:opacity-85"
const secondaryButton =
  "flex h-11 w-full items-center justify-center rounded-full border border-hairline text-sm transition-colors hover:border-ink"

export function LiveMeetingRoom({
  code,
  title,
  subtitle,
  sidePanels,
}: {
  code: string
  title: string
  subtitle: string
  sidePanels: ReactNode
}) {
  const router = useRouter()
  const { getToken, isLoaded, isSignedIn } = useAuth()
  const [phase, setPhase] = useState<Phase>({ kind: "connecting" })

  // Read once: this component only renders client-side, behind the join gate.
  const [media, setMedia] = useState<MediaPrefs>(readMediaPrefs)
  const liveMedia = useRef<Pick<MediaPrefs, "micOn" | "camOn">>({
    micOn: media.micOn,
    camOn: media.camOn,
  })
  const trackMedia = useCallback(
    (state: Pick<MediaPrefs, "micOn" | "camOn">) => {
      liveMedia.current = state
    },
    [],
  )

  // Set once this browser has chosen to go — leaving, or ending the call — so
  // the disconnect that follows is not mistaken for a dropped connection.
  const leaving = useRef(false)

  // A guest presents the token issued at join; a signed-in user is recognised
  // by their Clerk session.
  const authToken = useCallback(async () => {
    return readParticipant(code)?.guestToken ?? (await getToken())
  }, [code, getToken])

  /**
   * One request for a token, turned into the phase it leads to. Null means the
   * request itself failed — offline, API down — and is worth repeating.
   */
  const requestEntry = useCallback(async (): Promise<Phase | null> => {
    try {
      return { kind: "live", connection: await fetchMeetingToken(code, await authToken()) }
    } catch (error) {
      if (!(error instanceof MeetingAccessError)) return null

      if (error.reason === "waiting") return { kind: "waiting" }
      if (error.reason === "denied") {
        return {
          kind: "closed",
          heading: "You were not let in",
          detail: "The host declined your request to join.",
          action: "ask-again",
        }
      }
      if (error.status === 409) {
        return {
          kind: "closed",
          heading: "This meeting has ended",
          detail: "There is nobody left to join.",
          action: "home",
        }
      }
      if (error.status === 403) {
        return {
          kind: "closed",
          heading: "You are no longer in this meeting",
          detail: error.message,
          action: "ask-again",
        }
      }
      if (error.status >= 500) return null
      return {
        kind: "closed",
        heading: "Could not join the meeting",
        detail: error.message,
        action: "home",
      }
    }
  }, [authToken, code])

  // Drives every phase that is waiting on the API: the first connect, polling
  // at the door, and rejoining after a lost connection.
  useEffect(() => {
    if (!isLoaded) return
    if (phase.kind !== "connecting" && phase.kind !== "waiting" && phase.kind !== "lost") {
      return
    }

    let cancelled = false
    let timer: number | undefined

    const run = async () => {
      const next = await requestEntry()
      if (cancelled) return

      if (next) {
        // A fresh object even when still waiting, which is what schedules the
        // next poll.
        setPhase(next)
      } else if (phase.kind === "lost") {
        setPhase({ kind: "lost", attempt: phase.attempt + 1 })
      } else if (phase.kind === "waiting") {
        setPhase({ kind: "waiting" })
      } else {
        setPhase({
          kind: "closed",
          heading: "Could not reach the meeting",
          detail: "Check your connection and try again.",
          action: "retry",
        })
      }
    }

    const onOnline = () => {
      window.clearTimeout(timer)
      void run()
    }

    if (phase.kind === "lost") {
      // Offline, a request cannot succeed; wait for the network to come back
      // instead of burning attempts.
      window.addEventListener("online", onOnline)
      if (navigator.onLine) timer = window.setTimeout(run, retryDelay(phase.attempt))
    } else {
      timer = window.setTimeout(run, phase.kind === "waiting" ? WAITING_POLL_MS : 0)
    }

    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener("online", onOnline)
    }
  }, [isLoaded, phase, requestEntry])

  /** Releases the seat. Safe to call twice: the leave button and the
   *  disconnect it causes both arrive here. */
  const handleLeave = useCallback(() => {
    if (leaving.current) return
    leaving.current = true

    // Read the guest token before the seat is forgotten locally — it is what
    // authenticates the call that releases it server-side.
    const guestToken = readParticipant(code)?.guestToken ?? null
    void (async () => {
      try {
        await leaveMeeting(code, guestToken ?? (await getToken()))
      } catch {
        // Releasing the seat is a courtesy to everyone still in the room; it
        // must never stand between this person and leaving.
      }
    })()

    clearParticipant(code)
  }, [code, getToken])

  const handleEndForAll = useCallback(async () => {
    // The room is about to be deleted under us; that is not a dropped call.
    leaving.current = true
    try {
      await endMeetingForAll(code, await getToken())
    } catch (error) {
      leaving.current = false
      throw error
    }
    clearParticipant(code)
    router.push("/dashboard")
  }, [code, getToken, router])

  const handleDisconnected = useCallback(
    (reason?: DisconnectReason) => {
      if (leaving.current) return

      switch (reason) {
        case DisconnectReason.CLIENT_INITIATED:
          // This browser hung up — the leave button, or navigating away.
          handleLeave()
          return
        case DisconnectReason.ROOM_DELETED:
          setPhase({
            kind: "closed",
            heading: "The host ended the meeting",
            detail: "Thanks for joining.",
            action: "home",
          })
          return
        case DisconnectReason.PARTICIPANT_REMOVED:
          setPhase({
            kind: "closed",
            heading: "You were removed from the meeting",
            detail: "The host took you out of the call.",
            action: "ask-again",
          })
          return
        case DisconnectReason.DUPLICATE_IDENTITY:
          setPhase({
            kind: "closed",
            heading: "You joined from somewhere else",
            detail: "This meeting is open in another tab or window.",
            action: "retry",
            retryLabel: "Use this tab instead",
          })
          return
        default:
          // Anything else is the network. Rejoin as they were, with the
          // devices they last picked.
          setMedia({ ...readMediaPrefs(), ...liveMedia.current })
          setPhase({ kind: "lost", attempt: 0 })
      }
    },
    [handleLeave],
  )

  const handleError = useCallback(
    (error: Error) => {
      // Device failures surface here too and leave the call itself intact; only
      // a failed connection needs the room to step in.
      if (error instanceof ConnectionError && !leaving.current) {
        setMedia({ ...readMediaPrefs(), ...liveMedia.current })
        setPhase({ kind: "lost", attempt: 0 })
      }
    },
    [],
  )

  const giveUpSeat = useCallback(
    (then: "join-form" | "home") => {
      leaving.current = true
      clearParticipant(code)
      if (then === "home") router.push(isSignedIn ? "/dashboard" : "/")
    },
    [code, isSignedIn, router],
  )

  const cancelWaiting = useCallback(() => {
    handleLeave()
  }, [handleLeave])

  const roomOptions = useMemo<RoomOptions>(
    () => ({
      audioCaptureDefaults: media.audioInputId ? { deviceId: media.audioInputId } : undefined,
      videoCaptureDefaults: media.videoInputId ? { deviceId: media.videoInputId } : undefined,
      audioOutput: media.audioOutputId ? { deviceId: media.audioOutputId } : undefined,
    }),
    [media.audioInputId, media.videoInputId, media.audioOutputId],
  )

  const isHost = phase.kind === "live" && phase.connection.participant.role === "host"

  const hostControls = useMemo<HostControls>(
    () => ({
      isHost,
      moderate: async (participantId, action) =>
        moderateParticipant(code, participantId, action, await getToken()),
    }),
    [code, getToken, isHost],
  )

  if (phase.kind === "connecting") {
    return (
      <main className="flex flex-1 items-center justify-center bg-canvas p-6">
        <div
          aria-hidden
          className="h-64 w-full max-w-3xl animate-pulse rounded-2xl bg-ink/5"
        />
        <span className="sr-only">Connecting to the meeting…</span>
      </main>
    )
  }

  if (phase.kind === "waiting") {
    return (
      <Notice
        eyebrow="Waiting room"
        heading="Asking to join…"
        detail="You will join as soon as the host lets you in."
      >
        <button type="button" onClick={cancelWaiting} className={secondaryButton}>
          Cancel
        </button>
      </Notice>
    )
  }

  if (phase.kind === "lost") {
    return (
      <Notice
        eyebrow="Connection lost"
        heading="Reconnecting…"
        detail="Your seat is being kept. You will be back in the call as soon as the connection returns."
      >
        <button
          type="button"
          onClick={() => setPhase({ kind: "connecting" })}
          className={primaryButton}
        >
          Try now
        </button>
        <button
          type="button"
          onClick={() => {
            handleLeave()
            router.push(isSignedIn ? "/dashboard" : "/")
          }}
          className={secondaryButton}
        >
          Leave
        </button>
      </Notice>
    )
  }

  if (phase.kind === "closed") {
    return (
      <Notice eyebrow="Meeting" heading={phase.heading} detail={phase.detail}>
        {phase.action === "retry" ? (
          <button
            type="button"
            onClick={() => setPhase({ kind: "connecting" })}
            className={primaryButton}
          >
            {phase.retryLabel ?? "Try again"}
          </button>
        ) : null}
        {phase.action === "ask-again" ? (
          <button
            type="button"
            onClick={() => giveUpSeat("join-form")}
            className={primaryButton}
          >
            Ask to join again
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => giveUpSeat("home")}
          className={phase.action === "home" ? primaryButton : secondaryButton}
        >
          {isSignedIn ? "Back to dashboard" : "Back to home"}
        </button>
      </Notice>
    )
  }

  return (
    <HostControlsContext.Provider value={hostControls}>
      <LiveKitRoom
        // A new token after a rejoin is a new connection, not an update.
        key={phase.connection.token}
        token={phase.connection.token}
        serverUrl={phase.connection.url}
        connect
        options={roomOptions}
        audio={media.micOn}
        video={media.camOn}
        onDisconnected={handleDisconnected}
        onError={handleError}
        className="flex flex-1 flex-col"
      >
        <RoomLayout
          code={code}
          title={title}
          subtitle={subtitle}
          sidePanels={sidePanels}
          isHost={isHost}
          onLeave={handleLeave}
          onEndForAll={handleEndForAll}
          onMediaChange={trackMedia}
        />
      </LiveKitRoom>
    </HostControlsContext.Provider>
  )
}
