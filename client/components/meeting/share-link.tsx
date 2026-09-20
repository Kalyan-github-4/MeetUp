"use client"

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import { Copy01Icon, Tick02Icon } from "@hugeicons/core-free-icons"
import { cn } from "cn"

import { meetingPath, meetingUrl } from "@/lib/meeting-url"
import { Button } from "@/components/ui/button"
import { Icon } from "@/components/ui/icon"

/** How long the confirmation stays up before the button offers to copy again. */
const FEEDBACK_MS = 2200

type CopyState = "idle" | "copied" | "failed"

/**
 * The absolute URL for a meeting, resolved in the browser.
 *
 * The origin has to come from the tab rather than the server: it is the one a
 * guest can actually open, and it stays correct across localhost, a preview
 * deployment and production with nothing configured. `NEXT_PUBLIC_APP_URL`
 * overrides it for the one case the browser cannot know about — a server
 * reached through a proxy on a different public hostname.
 *
 * Null while rendering on the server and during hydration, so the markup never
 * contains a guessed origin that would then have to be corrected. Read through
 * `useSyncExternalStore` because the location is exactly that: a value owned
 * outside React, which no effect needs to copy into state.
 */
function useMeetingUrl(code: string): string | null {
  const origin = useSyncExternalStore(
    // The origin cannot change without a navigation, which unmounts this.
    subscribeToNothing,
    () => process.env.NEXT_PUBLIC_APP_URL ?? window.location.origin,
    () => process.env.NEXT_PUBLIC_APP_URL ?? null,
  )

  return origin ? meetingUrl(code, origin) : null
}

function subscribeToNothing(): () => void {
  return () => {}
}

/** Writes to the clipboard, falling back for browsers without the async API. */
async function writeToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission refused, or not a secure context — try the old way instead.
  }

  const area = document.createElement("textarea")
  area.value = text
  area.setAttribute("readonly", "")
  // Kept on screen but invisible: `display: none` cannot be selected, and a
  // position off-canvas scrolls the page on iOS.
  area.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none"
  document.body.append(area)
  area.select()

  try {
    return document.execCommand("copy")
  } catch {
    return false
  } finally {
    area.remove()
  }
}

/**
 * Copying, with the outcome held just long enough to be read.
 *
 * Failure is reported rather than swallowed, because the caller's answer to it
 * is to select the link so the reader can copy it by hand.
 */
function useCopy(): { state: CopyState; copy: (text: string) => void } {
  const [state, setState] = useState<CopyState>("idle")

  useEffect(() => {
    if (state === "idle") return
    const timer = setTimeout(() => setState("idle"), FEEDBACK_MS)
    return () => clearTimeout(timer)
  }, [state])

  const copy = useCallback((text: string) => {
    void writeToClipboard(text).then((ok) => setState(ok ? "copied" : "failed"))
  }, [])

  return { state, copy }
}

/**
 * The meeting link, shown in full, with a button that copies it.
 *
 * The link sits in a read-only input rather than a paragraph so it can be
 * focused, selected and long-pressed — which is what makes the fallback path
 * usable when the clipboard is unavailable.
 */
export function MeetingLinkField({
  code,
  className,
}: {
  code: string
  className?: string
}) {
  const url = useMeetingUrl(code)
  const field = useRef<HTMLInputElement>(null)
  const { state, copy } = useCopy()

  function onCopy() {
    if (!url) return
    copy(url)
    // Selected either way: it confirms what was copied, and it is the only
    // thing left to offer if the clipboard refused.
    field.current?.select()
  }

  return (
    <div className={className}>
      <div className="flex items-center gap-2 rounded-xl border bg-background p-1.5 pl-3">
        <input
          ref={field}
          readOnly
          // Until the origin is known there is still something worth showing,
          // and it is the part of the link that identifies the meeting.
          value={url ?? meetingPath(code)}
          aria-label="Meeting link"
          onFocus={(event) => event.currentTarget.select()}
          className="min-w-0 flex-1 truncate bg-transparent font-mono text-sm outline-none"
        />

        <Button
          type="button"
          onClick={onCopy}
          disabled={!url}
          aria-live="polite"
          className="shrink-0"
        >
          <Icon
            icon={state === "copied" ? Tick02Icon : Copy01Icon}
            size={16}
            strokeWidth={2}
            data-icon="inline-start"
          />
          {state === "copied" ? "Copied" : "Copy link"}
        </Button>
      </div>

      {state === "failed" ? (
        <p role="alert" className="mt-2 text-xs text-muted-foreground">
          Couldn’t reach the clipboard — the link is selected, press
          {" "}
          <kbd className="font-mono">Ctrl</kbd>/
          <kbd className="font-mono">⌘</kbd>+<kbd className="font-mono">C</kbd>
          {" "}to copy it.
        </p>
      ) : null}
    </div>
  )
}

/**
 * The compact form for inside the call: the code, which copies the whole link.
 *
 * The code is what people read out loud, so it stays the visible label; the
 * clipboard gets the URL, because that is what a guest can open.
 */
export function CopyLinkButton({
  code,
  className,
}: {
  code: string
  className?: string
}) {
  const url = useMeetingUrl(code)
  const { state, copy } = useCopy()

  return (
    <button
      type="button"
      onClick={() => url && copy(url)}
      disabled={!url}
      aria-label={`Copy link to meeting ${code}`}
      className={cn(
        "flex items-center gap-2 rounded-full border border-hairline px-3 py-1.5 font-mono text-xs tracking-widest transition-colors hover:border-ink disabled:opacity-50",
        className,
      )}
    >
      {code}
      <Icon
        icon={state === "copied" ? Tick02Icon : Copy01Icon}
        size={14}
        strokeWidth={2}
      />
      <span className="sr-only" aria-live="polite">
        {state === "copied" ? "Link copied" : ""}
      </span>
    </button>
  )
}
