import { cn } from "cn"

import { initials } from "@/lib/types"

/** Shown in place of a camera feed, and beside names in lists. */
export function InitialsAvatar({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "flex items-center justify-center bg-ink/8 font-medium text-ink-muted select-none [container-type:size]",
        className,
      )}
    >
      <span aria-hidden className="text-[max(0.75rem,min(28cqmin,4rem))]">
        {initials(name) || "?"}
      </span>
    </span>
  )
}
