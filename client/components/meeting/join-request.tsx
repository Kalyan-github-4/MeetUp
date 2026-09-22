"use client"

import { Cancel01Icon, Tick02Icon } from "@hugeicons/core-free-icons"

import { Icon } from "@/components/ui/icon"
import { InitialsAvatar } from "@/components/meeting/initials-avatar"

/** One knock at the door, with the host's two answers. */
export function JoinRequest({
  name,
  busy,
  onAdmit,
  onDeny,
}: {
  name: string
  busy: boolean
  onAdmit: () => void
  onDeny: () => void
}) {
  return (
    <div className="flex items-center gap-3 rounded-full border border-hairline bg-canvas py-1.5 pr-1.5 pl-1.5">
      <InitialsAvatar name={name} className="size-8 shrink-0 rounded-full" />
      <p className="min-w-0 flex-1 truncate text-sm">
        <span className="font-medium">{name}</span>
        <span className="text-ink-muted"> wants to join</span>
      </p>
      <button
        type="button"
        onClick={onDeny}
        disabled={busy}
        aria-label={`Deny ${name}`}
        className="flex size-9 shrink-0 items-center justify-center rounded-full border border-hairline text-ink transition-colors hover:border-ember hover:text-ember disabled:opacity-40"
      >
        <Icon icon={Cancel01Icon} size={16} strokeWidth={2} />
      </button>
      <button
        type="button"
        onClick={onAdmit}
        disabled={busy}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-ink px-4 text-sm font-medium text-canvas transition-opacity hover:opacity-85 disabled:opacity-40"
      >
        <Icon icon={Tick02Icon} size={15} strokeWidth={2} />
        Admit
      </button>
    </div>
  )
}
