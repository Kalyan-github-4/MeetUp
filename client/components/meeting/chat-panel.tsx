"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useAuth } from "@clerk/nextjs"
import {
  useDataChannel,
  useLocalParticipant,
  useParticipants,
} from "@livekit/components-react"
import {
  SentIcon,
  SmileIcon,
  UserRemove01Icon,
} from "@hugeicons/core-free-icons"
import { cn } from "cn"

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
import { EmojiPicker } from "@/components/meeting/emoji-picker"
import { InitialsAvatar } from "@/components/meeting/initials-avatar"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

const MAX_MESSAGE_LENGTH = 2000

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
}: {
  message: ChatEnvelope
  isSelf: boolean
}) {
  return (
    <li className={cn("flex items-end gap-2", isSelf && "flex-row-reverse")}>
      <InitialsAvatar
        name={message.authorName}
        className="mb-0.5 size-8 shrink-0 rounded-full"
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
 * The host's remove button beside one person. Removing asks twice — it
 * disconnects them — and the question withdraws itself after a few seconds.
 *
 * There is deliberately no control over anyone's microphone: a mic belongs to
 * the person sitting behind it, and a host who could silence one without
 * asking could just as easily open one.
 */
function HostActions({ id, name }: { id: string; name: string }) {
  const { moderate } = useHostControls()
  const [busy, setBusy] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!confirming) return
    const timer = window.setTimeout(() => setConfirming(false), 4000)
    return () => window.clearTimeout(timer)
  }, [confirming])

  async function act(action: "remove") {
    if (!confirming) {
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
  const [pickerOpen, setPickerOpen] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  /** Where the caret goes once the draft with the new emoji has rendered. */
  const pendingCaret = useRef<number | null>(null)

  const closePicker = useCallback(() => setPickerOpen(false), [])

  // Put the caret back after the inserted emoji: setting the value from state
  // would otherwise leave it at the end of the input.
  useEffect(() => {
    const input = inputRef.current
    const caret = pendingCaret.current
    if (!input || caret === null) return
    pendingCaret.current = null
    input.focus()
    input.setSelectionRange(caret, caret)
  }, [draft])

  const insertEmoji = useCallback(
    (emoji: string) => {
      const input = inputRef.current
      // The input keeps its selection while the picker has focus, so this is
      // still where the person was typing.
      const start = input?.selectionStart ?? draft.length
      const end = input?.selectionEnd ?? draft.length
      const next = draft.slice(0, start) + emoji + draft.slice(end)

      setPickerOpen(false)
      if (next.length > MAX_MESSAGE_LENGTH) return

      pendingCaret.current = start + emoji.length
      setDraft(next)
    },
    [draft],
  )

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
      setPickerOpen(false)
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
      })),
    [participants],
  )

  return (
    <section
      aria-label="Room chat"
      className={cn(
        // `overflow-hidden` is the backstop: whatever the panel is given for a
        // height, its contents scroll within it rather than spilling out and
        // pushing the page down.
        "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-hairline p-4",
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
            {pickerOpen ? (
              <EmojiPicker
                onSelect={insertEmoji}
                onClose={closePicker}
                toggleRef={emojiButtonRef}
                className="absolute inset-x-0 bottom-full mb-2"
              />
            ) : null}

            <button
              ref={emojiButtonRef}
              type="button"
              onClick={() => setPickerOpen((open) => !open)}
              aria-label={pickerOpen ? "Close emoji picker" : "Add emoji"}
              aria-expanded={pickerOpen}
              aria-haspopup="dialog"
              className={cn(
                "absolute top-1/2 left-1.5 z-10 flex size-8 -translate-y-1/2 items-center justify-center rounded-full transition-colors hover:bg-ink/5 hover:text-ink",
                pickerOpen ? "bg-ink/8 text-ink" : "text-ink-muted",
              )}
            >
              <Icon icon={SmileIcon} size={17} strokeWidth={1.8} />
            </button>
            <Input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type something..."
              aria-label="Message"
              maxLength={MAX_MESSAGE_LENGTH}
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
                <InitialsAvatar
                  name={participant.name}
                  className="size-8 shrink-0 rounded-full"
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
                  <HostActions id={participant.id} name={participant.name} />
                ) : null}
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </section>
  )
}
