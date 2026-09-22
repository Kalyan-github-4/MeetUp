import Link from "next/link"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { cn } from "cn"

import { MeetingLinkField } from "@/components/meeting/share-link"
import { Icon } from "@/components/ui/icon"

/**
 * The room's title bar.
 *
 * Leads with the meeting link: it is the one thing on this screen someone in
 * the call has to hand to the next person, so it sits where the eye starts.
 */
export function MeetingHeader({
  code,
  className,
}: {
  code: string
  className?: string
}) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-3 border-b border-hairline pb-4",
        className,
      )}
    >
      <Link
        href="/dashboard"
        aria-label="Back to dashboard"
        className="flex size-10 shrink-0 items-center justify-center rounded-full border border-hairline transition-colors hover:border-ink"
      >
        <Icon icon={ArrowLeft01Icon} size={18} strokeWidth={1.8} />
      </Link>

      <MeetingLinkField code={code} className="w-full max-w-xl" />

      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs tracking-[0.18em] text-ink-muted uppercase">
        <span className="size-1.5 rounded-full bg-ember" />
        Live
      </span>
    </header>
  )
}
