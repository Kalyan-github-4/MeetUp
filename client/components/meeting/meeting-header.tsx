import Link from "next/link"
import { ArrowLeft01Icon } from "@hugeicons/core-free-icons"
import { cn } from "cn"

import { CopyLinkButton } from "@/components/meeting/share-link"
import { Icon } from "@/components/ui/icon"

type MeetingHeaderProps = {
  title: string
  subtitle: string
  code: string
  className?: string
}

/**
 * The room's title bar.
 *
 * Carried by a single rule rather than a filled pill: the stage below is the
 * only thing here worth a surface of its own.
 */
export function MeetingHeader({
  title,
  subtitle,
  code,
  className,
}: MeetingHeaderProps) {
  return (
    <header
      className={cn(
        "flex shrink-0 items-center gap-4 border-b border-hairline pb-4",
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

      <div className="min-w-0">
        <h1 className="truncate text-lg font-medium tracking-tight">{title}</h1>
        <p className="truncate text-xs text-ink-muted">{subtitle}</p>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-4">
        <span className="flex items-center gap-2 text-xs tracking-[0.18em] text-ink-muted uppercase">
          <span className="size-1.5 rounded-full bg-ember" />
          Live
        </span>

        {/* The code, which hands over the shareable link — someone already in
            the call is the one person who needs to invite the next. */}
        <CopyLinkButton code={code} className="hidden sm:flex" />
      </div>
    </header>
  )
}
