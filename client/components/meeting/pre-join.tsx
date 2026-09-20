"use client"

import {
  useCallback,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@clerk/nextjs"

import { MODEL_COUNT } from "@/lib/avatars"
import {
  readMediaPrefs,
  saveMediaPrefs,
  type MediaPrefs,
} from "@/lib/media-prefs"
import { DevicePreview } from "@/components/meeting/device-preview"
import { ModelAvatar } from "@/components/meeting/model-avatar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  readParticipant,
  saveParticipant,
  subscribeToSeat,
} from "@/lib/meeting-seat"

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"

/**
 * `unknown` covers server rendering and hydration, when localStorage has not
 * been read yet — it is what keeps the skeleton on screen instead of briefly
 * flashing the join form at someone who has already joined.
 */
type JoinStatus = "unknown" | "joined" | "new"

function useJoinStatus(code: string): JoinStatus {
  return useSyncExternalStore<JoinStatus>(
    subscribeToSeat,
    // Returns a string literal, so repeated calls stay referentially equal.
    () => (readParticipant(code) !== null ? "joined" : "new"),
    () => "unknown",
  )
}

/**
 * Gate in front of the meeting room.
 *
 * The room itself is server-rendered and handed in as `children`, so the gate
 * decides only whether this browser has joined yet — it never re-renders the
 * meeting on the client.
 */
export function PreJoin({
  code,
  title,
  hostName,
  signedInName,
  children,
}: {
  code: string
  title: string
  hostName: string | null
  signedInName: string | null
  children: ReactNode
}) {
  const router = useRouter()
  const { getToken } = useAuth()
  const status = useJoinStatus(code)
  const [name, setName] = useState(signedInName ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Opens on an arbitrary figure so a room does not fill up with whoever is
  // first in the list. Safe to randomise: this screen never renders on the
  // server, so there is no markup to mismatch.
  const [avatar, setAvatar] = useState(() =>
    Math.floor(Math.random() * MODEL_COUNT),
  )
  // Read lazily for the same reason: this form only ever renders client-side.
  const [media, setMedia] = useState<MediaPrefs>(readMediaPrefs)

  // Stable, because the preview reopens devices whenever it changes.
  const changeMedia = useCallback((change: Partial<MediaPrefs>) => {
    setMedia((current) => ({ ...current, ...change }))
    saveMediaPrefs(change)
  }, [])

  async function join() {
    const displayName = name.trim()
    if (!displayName) {
      setError("Please enter a name so people know who joined.")
      return
    }

    setPending(true)
    setError(null)

    try {
      // Signed-in callers must say who they are: it is what makes the host
      // the host, and lets them in without waiting at their own door.
      const authToken = await getToken()
      const response = await fetch(`${API_URL}/meetings/${code}/join`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        },
        body: JSON.stringify({ displayName }),
      })

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as
          | { error?: string }
          | null
        throw new Error(body?.error ?? "Could not join this meeting.")
      }

      const result = (await response.json()) as {
        participant: { id: string; displayName: string }
        guestToken: string | null
      }

      saveParticipant(code, {
        participantId: result.participant.id,
        displayName: result.participant.displayName,
        guestToken: result.guestToken,
        avatar,
      })
      // Pull the participant list that now includes us.
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not join.")
    } finally {
      setPending(false)
    }
  }

  // Server-rendered and mid-hydration: show a placeholder rather than flashing
  // the page blank or showing the wrong screen.
  if (status === "unknown") {
    return (
      <main className="flex flex-1 items-center justify-center bg-canvas p-6">
        <div
          aria-hidden
          className="h-64 w-full max-w-sm animate-pulse rounded-2xl bg-ink/5"
        />
        <span className="sr-only">Loading meeting…</span>
      </main>
    )
  }

  if (status === "joined") return <>{children}</>

  return (
    <main className="flex flex-1 items-center justify-center bg-canvas p-6 text-ink">
      <div className="w-full max-w-md rounded-2xl border border-hairline p-6 sm:p-8">
        <p className="flex items-center gap-2.5 text-xs tracking-[0.18em] text-ink-muted uppercase">
          <span className="size-2 rounded-full border border-ember" />
          Joining
        </p>

        <h1 className="mt-5 text-2xl font-medium tracking-tight">{title}</h1>
        <p className="mt-1.5 text-sm text-ink-muted">
          {hostName ? `Hosted by ${hostName}` : "Ready when you are"}
        </p>

        <div className="mt-7">
          <DevicePreview
            prefs={media}
            onChange={changeMedia}
            fallback={
              <ModelAvatar
                id={code}
                name={name.trim() || "You"}
                index={avatar}
                className="absolute inset-0 size-full"
              />
            }
            footer={
              <div className="flex items-center justify-between border-t border-hairline px-3 py-2">
                <button
                  type="button"
                  onClick={() => setAvatar((current) => current - 1)}
                  aria-label="Previous figure"
                  className="flex size-8 items-center justify-center rounded-full border border-hairline text-sm transition-colors hover:border-ink"
                >
                  ‹
                </button>

                <p className="text-xs tracking-[0.18em] text-ink-muted uppercase">
                  Stand-in {(((avatar % MODEL_COUNT) + MODEL_COUNT) % MODEL_COUNT) + 1}{" "}
                  / {MODEL_COUNT}
                </p>

                <button
                  type="button"
                  onClick={() => setAvatar((current) => current + 1)}
                  aria-label="Next figure"
                  className="flex size-8 items-center justify-center rounded-full border border-hairline text-sm transition-colors hover:border-ink"
                >
                  ›
                </button>
              </div>
            }
          />
        </div>

        <p className="mt-2.5 text-xs text-ink-muted">
          Your stand-in is shown to everyone whenever your camera is off.
        </p>

        <label
          htmlFor="display-name"
          className="mt-6 block text-sm font-medium"
        >
          Your name
        </label>
        <Input
          id="display-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void join()
          }}
          placeholder="e.g. Alex Rivera"
          className="mt-2 h-11 rounded-full border-hairline bg-transparent px-4"
          autoFocus
        />

        {error ? (
          <p role="alert" className="mt-2.5 text-sm text-ember">
            {error}
          </p>
        ) : null}

        <Button
          onClick={() => void join()}
          disabled={pending}
          className="mt-5 h-11 w-full bg-ink text-canvas hover:bg-ink/85"
        >
          {pending ? "Joining…" : "Join meeting"}
        </Button>

        <p className="mt-4 text-center text-xs text-ink-muted">
          No account needed to join.
        </p>
      </div>
    </main>
  )
}
