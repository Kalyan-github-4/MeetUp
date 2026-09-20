"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "@clerk/nextjs"
import {
  useDataChannel,
  useLocalParticipant,
  useParticipants,
} from "@livekit/components-react"
import {
  MicOff01Icon,
  SentIcon,
  SmileIcon,
  UserRemove01Icon,
} from "@hugeicons/core-free-icons"
import { cn } from "cn"

import { AVATAR_ATTRIBUTE, parseAvatarAttribute } from "@/lib/avatars"
import {
  CHAT_TOPIC,
  decodeChat,
  encodeChat,
  fetchChatBacklog,
  formatSentAt,
  persistChatMessage,
  type ChatEnvelope,
} from "@/lib/chat"
import { useHostControls } from "@/lib/host-controls"
import { readParticipant } from "@/lib/meeting-seat"
import { ModelAvatar } from "@/components/meeting/model-avatar"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const triggerClassName =
  "rounded-full border-transparent px-3.5 text-ink-muted data-active:bg-ink data-active:text-canvas"

/**
 * Adds a message to the list, ignoring one already present.
 *
 * Ids are allocated by the sender, so the stored backlog and the copy that
 * arrived over the data channel collide by key rather than duplicating — which
 * is what makes it safe to merge the two in any order.
 */
function mergeMessage(
  current: ChatEnvelope[],
  incoming: ChatEnvelope,
): ChatEnvelope[] {
  if (current.some((message) => message.id === incoming.id)) return current

  return [...current, incoming].sort((a, b) => a.sentAt.localeCompare(b.sentAt))
}

function Message({
  message,
  isSelf,
  avatar,
}: {
  message: ChatEnvelope
  isSelf: boolean
  /** Null once the author has left — their figure falls back to the default. */
  avatar: number | null
}) {
  return (
    <li className={cn("flex items-end gap-2", isSelf && "flex-row-reverse")}>
      <ModelAvatar
        id={message.authorId}
        name={message.authorName}
        index={avatar ?? undefined}
        className="mb-0.5 size-8 shrink-0 overflow-hidden rounded-full"
      />

      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3.5 py-2.5",
          isSelf ? "bg-ink text-canvas" : "bg-ink/5 text-ink",
        )}
      >
        {isSelf ? null : (
          <p className="text-xs font-medium text-ink-muted">
            {message.authorName}
          </p>
        )}
        <p className="text-sm leading-snug">{message.body}</p>
        <p
          className={cn(
            "mt-1 text-[10px]",
            isSelf ? "text-canvas/60" : "text-ink-muted",
          )}
        >
          {formatSentAt(message.sentAt)}
        </p>
      </div>
    </li>
  )
}

/**
 * The host's mute and remove buttons beside one person. Removing asks twice —
 * it disconnects them — and the question withdraws itself after a few seconds.
 */
function HostActions({
  id,
  name,
  micOn,
}: {
  id: string
  name: string
  micOn: boolean
}) {
  const { moderate } = useHostControls()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!confirming) return
    const timer = window.setTimeout(() => setConfirming(false), 4000)
    return () => window.clearTimeout(timer)
  }, [confirming])

  async function act(action: "mute" | "remove") {
    if (action === "remove" && !confirming) {
      setConfirming(true)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await moderate(id, action)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "That did not work.")
    } finally {
      setBusy(false)
      setConfirming(false)
    }
  }

  return (
    <span className="ml-auto flex shrink-0 items-center gap-1.5">
      {error ? (
        <span role="alert" className="max-w-28 truncate text-xs text-ember" title={error}>
          {error}
        </span>
      ) : null}
      {micOn ? (
        <button
          type="button"
          onClick={() => void act("mute")}
          disabled={busy}
          aria-label={`Mute ${name}`}
          title={`Mute ${name}`}
          className="flex size-8 items-center justify-center rounded-full border border-hairline transition-colors hover:border-ink disabled:opacity-40"
        >
          <Icon icon={MicOff01Icon} size={14} strokeWidth={1.8} />
        </button>
      ) : null}
      <button
        type="button"
        onClick={() => void act("remove")}
        disabled={busy}
        aria-label={confirming ? `Confirm removing ${name}` : `Remove ${name}`}
        title={`Remove ${name}`}
        className={cn(
          "flex h-8 items-center justify-center rounded-full border transition-colors disabled:opacity-40",
          confirming
            ? "border-ember bg-ember px-3 text-xs font-medium text-white"
            : "w-8 border-hairline hover:border-ember hover:text-ember",
        )}
      >
        {confirming ? "Remove?" : <Icon icon={UserRemove01Icon} size={14} strokeWidth={1.8} />}
      </button>
    </span>
  )
}

/**
 * Room chat and the participant list.
 *
 * Messages are carried by LiveKit's data channel — that is what makes them
 * appear instantly — and stored through the API only so a late joiner can be
 * shown what was said before they arrived. Must render inside `LiveKitRoom`.
 */
export function ChatPanel({
  code,
  className,
}: {
  code: string
  className?: string
}) {
  const { getToken } = useAuth()
  const { isHost } = useHostControls()
  const { localParticipant } = useLocalParticipant()
  const participants = useParticipants()

  const [messages, setMessages] = useState<ChatEnvelope[]>([])
  const [draft, setDraft] = useState("")
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const receive = useCallback((payload: Uint8Array) => {
    const message = decodeChat(payload)
    if (message) setMessages((current) => mergeMessage(current, message))
  }, [])

  const { send } = useDataChannel(CHAT_TOPIC, (data) => receive(data.payload))

  // A guest presents the token issued at join; a signed-in user is recognised
  // by their Clerk session. Same rule as connecting to the room itself.
  const authToken = useCallback(async () => {
    return readParticipant(code)?.guestToken ?? (await getToken())
  }, [code, getToken])

  useEffect(() => {
    let cancelled = false

    async function loadBacklog() {
      try {
        const backlog = await fetchChatBacklog(code, await authToken())
        if (cancelled) return

        // Merged one by one rather than replacing: messages may already have
        // arrived live while this request was in flight.
        setMessages((current) =>
          backlog.reduce(
            (accumulator, message) => mergeMessage(accumulator, message),
            current,
          ),
        )
      } catch {
        // The history is a convenience — losing it should not stop someone
        // taking part in the conversation happening now.
      }
    }

    void loadBacklog()
    return () => {
      cancelled = true
    }
  }, [authToken, code])

  // Follow the conversation as it grows.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages])

  const handleSubmit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()

      const body = draft.trim()
      if (!body) return

      const message: ChatEnvelope = {
        id: crypto.randomUUID(),
        authorId: localParticipant.identity,
        authorName: localParticipant.name || "Someone",
        body,
        sentAt: new Date().toISOString(),
      }

      setDraft("")
      setError(null)
      // The data channel does not echo a frame back to its sender.
      setMessages((current) => mergeMessage(current, message))

      try {
        await send(encodeChat(message), { reliable: true })
      } catch {
        setMessages((current) => current.filter((m) => m.id !== message.id))
        setDraft(body)
        setError("Message not sent. Check your connection.")
        return
      }

      try {
        await persistChatMessage(code, await authToken(), {
          id: message.id,
          body: message.body,
        })
      } catch {
        // Everyone in the room already has this message; only a later joiner
        // would miss it, which is not worth interrupting the sender over.
      }
    },
    [authToken, code, draft, localParticipant, send],
  )

  const roster = useMemo(
    () =>
      participants.map((participant) => ({
        id: participant.identity,
        name: participant.name || "Guest",
        isLocal: participant.isLocal,
        micOn: participant.isMicrophoneEnabled,
        avatar: parseAvatarAttribute(
          participant.attributes?.[AVATAR_ATTRIBUTE],
        ),
      })),
    [participants],
  )

  // Authors of backlog messages may have left, so this resolves what it can
  // and lets the rest fall back.
  const avatarFor = useCallback(
    (authorId: string) =>
      roster.find((participant) => participant.id === authorId)?.avatar ?? null,
    [roster],
  )

  return (
    <section
      aria-label="Room chat"
      className={cn(
        "flex flex-col rounded-2xl border border-hairline p-4",
        className,
      )}
    >
      <Tabs defaultValue="chat" className="min-h-0 flex-1 gap-4">
        <TabsList className="self-start">
          <TabsTrigger value="chat" className={triggerClassName}>
            Room Chat
          </TabsTrigger>
          <TabsTrigger value="participants" className={triggerClassName}>
            Participants ({roster.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="flex min-h-0 flex-col gap-4">
          <ul
            ref={listRef}
            className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
          >
            {messages.length === 0 ? (
              <li className="m-auto text-center text-sm text-ink-muted">
                No messages yet.
              </li>
            ) : (
              messages.map((message) => (
                <Message
                  key={message.id}
                  message={message}
                  isSelf={message.authorId === localParticipant.identity}
                  avatar={avatarFor(message.authorId)}
                />
              ))
            )}
          </ul>

          {error ? (
            <p role="alert" className="shrink-0 text-xs text-destructive">
              {error}
            </p>
          ) : null}

          <form onSubmit={handleSubmit} className="relative shrink-0">
            <span className="absolute top-1/2 left-3 -translate-y-1/2 text-ink-muted">
              <Icon icon={SmileIcon} size={17} strokeWidth={1.8} />
            </span>
            <Input
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type something..."
              aria-label="Message"
              maxLength={2000}
              className="h-11 rounded-full border-hairline bg-transparent pr-12 pl-10"
            />
            <Button
              type="submit"
              size="icon-sm"
              disabled={draft.trim().length === 0}
              aria-label="Send message"
              className="absolute top-1/2 right-2 -translate-y-1/2 bg-ink text-canvas hover:bg-ink/85"
            >
              <Icon icon={SentIcon} size={15} strokeWidth={1.8} />
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="participants" className="min-h-0 overflow-y-auto">
          <ul className="flex flex-col gap-3">
            {roster.map((participant) => (
              <li key={participant.id} className="flex items-center gap-2.5">
                <ModelAvatar
                  id={participant.id}
                  name={participant.name}
                  index={participant.avatar ?? undefined}
                  className="size-8 shrink-0 overflow-hidden rounded-full"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm">
                    {participant.name}
                    {participant.isLocal ? " (you)" : ""}
                  </span>
                  <span className="block truncate text-xs text-ink-muted">
                    {participant.micOn ? "Mic on" : "Muted"}
                  </span>
                </span>
                {isHost && !participant.isLocal ? (
                  <HostActions
                    id={participant.id}
                    name={participant.name}
                    micOn={participant.micOn}
                  />
                ) : null}
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </section>
  )
}
