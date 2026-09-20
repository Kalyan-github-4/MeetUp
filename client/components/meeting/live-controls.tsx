"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  useLocalParticipant,
  useMediaDeviceSelect,
  useRoomContext,
} from "@livekit/components-react"
import {
  CallEnd01Icon,
  ComputerIcon,
  GridViewIcon,
  Mic01Icon,
  MicOff01Icon,
  Settings02Icon,
  SquareIcon,
  Video01Icon,
  VideoOffIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons"
import { cn } from "cn"

import { saveMediaPrefs, type MediaPrefs } from "@/lib/media-prefs"
import { DeviceSelect } from "@/components/meeting/device-select"
import { Icon } from "@/components/ui/icon"

export type RoomLayoutMode = "spotlight" | "grid"

/** Why a device would not start, in words worth showing in the room. */
function describeDeviceError(
  error: unknown,
  kind: "mic" | "camera" | "screen",
): string {
  const device =
    kind === "mic" ? "microphone" : kind === "camera" ? "camera" : "screen"
  const name = error instanceof DOMException ? error.name : ""

  if (name === "NotAllowedError") {
    return `Your ${device} is blocked. Allow it from the icon in the address bar, then try again.`
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return `No ${device} was found.`
  }
  if (name === "NotReadableError") {
    return `Your ${device} is in use by another app.`
  }
  return `Could not turn your ${device} back on.`
}

/**
 * One control. Filled when the device is live, hairline when it is not, so the
 * state of the room is legible without reading a single label.
 */
function Control({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string
  icon: typeof Mic01Icon
  active: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex size-11 items-center justify-center rounded-full border transition-colors disabled:opacity-40",
        active
          ? "border-ink bg-ink text-canvas"
          : "border-hairline bg-canvas text-ink hover:border-ink",
      )}
    >
      <Icon icon={icon} size={18} strokeWidth={1.8} />
    </button>
  )
}

/**
 * One device list bound to the live room. Switching here moves the published
 * track over without a reconnect, and is remembered for the next call.
 */
function RoomDeviceSelect({
  kind,
  label,
  icon,
  prefKey,
}: {
  kind: MediaDeviceKind
  label: string
  icon: typeof Mic01Icon
  prefKey: keyof Pick<MediaPrefs, "audioInputId" | "videoInputId" | "audioOutputId">
}) {
  const room = useRoomContext()
  const { devices, activeDeviceId, setActiveMediaDevice } = useMediaDeviceSelect({
    kind,
    room,
  })

  if (kind === "audiooutput" && devices.length === 0) return null

  return (
    <DeviceSelect
      label={label}
      icon={icon}
      devices={devices}
      value={activeDeviceId === "default" ? "" : activeDeviceId}
      onChange={(id) => {
        void setActiveMediaDevice(id || "default")
          .then(() => saveMediaPrefs({ [prefKey]: id || undefined }))
          .catch((error: unknown) => console.error(`Could not switch ${label}`, error))
      }}
    />
  )
}

/** The device picker, opened from the control bar. */
function DeviceSettings({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Dismissed the way any popover is: Escape, or a click anywhere else.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose()
    }
    function onPointer(event: PointerEvent) {
      if (!panelRef.current?.contains(event.target as Node)) onClose()
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("pointerdown", onPointer)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("pointerdown", onPointer)
    }
  }, [onClose])

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Audio and video settings"
      className="absolute bottom-full left-1/2 mb-3 grid w-80 max-w-[calc(100vw-2rem)] -translate-x-1/2 gap-2 rounded-2xl border border-hairline bg-canvas p-3 text-ink shadow-lg"
    >
      <RoomDeviceSelect kind="audioinput" label="Microphone" icon={Mic01Icon} prefKey="audioInputId" />
      <RoomDeviceSelect kind="videoinput" label="Camera" icon={Video01Icon} prefKey="videoInputId" />
      <RoomDeviceSelect kind="audiooutput" label="Speaker" icon={VolumeHighIcon} prefKey="audioOutputId" />
    </div>
  )
}

/**
 * The control bar at the foot of the stage.
 *
 * Toggles read their on/off state from LiveKit rather than local state, so a
 * device that fails to start (permission denied, camera in use) leaves the
 * button showing the truth instead of an optimistic lie.
 */
export function LiveControls({
  onLeave,
  isHost,
  onEndForAll,
  layout,
  onLayoutChange,
}: {
  onLeave: () => void
  isHost: boolean
  /** Rejects with a message fit to show when the meeting could not be ended. */
  onEndForAll: () => Promise<void>
  layout: RoomLayoutMode
  onLayoutChange: (layout: RoomLayoutMode) => void
}) {
  const room = useRoomContext()
  const {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
  } = useLocalParticipant()
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [deviceError, setDeviceError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Ending the call for everyone is the one action here that cannot be taken
  // back, so it asks twice. The question withdraws itself after a few seconds.
  const [confirmingEnd, setConfirmingEnd] = useState(false)
  const [endError, setEndError] = useState<string | null>(null)

  useEffect(() => {
    if (!confirmingEnd) return
    const timer = window.setTimeout(() => setConfirmingEnd(false), 4000)
    return () => window.clearTimeout(timer)
  }, [confirmingEnd])

  async function toggle(kind: "mic" | "camera" | "screen") {
    setBusy(true)
    setDeviceError(null)
    try {
      // The target is read from the participant, not from the rendered flag:
      // a mute can arrive from the host while this bar is on screen, and
      // acting on a stale flag would ask for the state the device is already
      // in — a click that does nothing, which is what leaves someone stuck
      // muted.
      if (kind === "mic") {
        await localParticipant.setMicrophoneEnabled(
          !localParticipant.isMicrophoneEnabled,
        )
      } else if (kind === "camera") {
        await localParticipant.setCameraEnabled(
          !localParticipant.isCameraEnabled,
        )
      } else {
        await localParticipant.setScreenShareEnabled(
          !localParticipant.isScreenShareEnabled,
        )
      }
    } catch (error) {
      // Most often a denied permission prompt, or a device another app has
      // taken. Saying so beats a button that silently refuses to move.
      setDeviceError(describeDeviceError(error, kind))
      console.error(`Could not toggle ${kind}`, error)
    } finally {
      setBusy(false)
    }
  }

  async function leave() {
    setBusy(true)
    await room.disconnect()
    onLeave()
    router.push("/dashboard")
  }

  async function endForAll() {
    if (!confirmingEnd) {
      setConfirmingEnd(true)
      return
    }
    setBusy(true)
    setEndError(null)
    try {
      await onEndForAll()
    } catch (error) {
      setEndError(error instanceof Error ? error.message : "Could not end the meeting.")
      setConfirmingEnd(false)
      setBusy(false)
    }
  }

  return (
    <div className="absolute inset-x-0 bottom-5 z-10 flex justify-center">
      {/* Wraps on a phone rather than running off the edge of the screen. */}
      <div className="flex max-w-[calc(100%-1.5rem)] flex-wrap items-center justify-center gap-2 rounded-[1.75rem] border border-hairline bg-canvas/90 p-2 backdrop-blur-md">
        <Control
          label={isMicrophoneEnabled ? "Mute microphone" : "Unmute microphone"}
          icon={isMicrophoneEnabled ? Mic01Icon : MicOff01Icon}
          active={isMicrophoneEnabled}
          disabled={busy}
          onClick={() => void toggle("mic")}
        />

        <Control
          label={isCameraEnabled ? "Turn camera off" : "Turn camera on"}
          icon={isCameraEnabled ? Video01Icon : VideoOffIcon}
          active={isCameraEnabled}
          disabled={busy}
          onClick={() => void toggle("camera")}
        />

        <Control
          label={isScreenShareEnabled ? "Stop sharing screen" : "Share screen"}
          icon={ComputerIcon}
          active={isScreenShareEnabled}
          disabled={busy}
          onClick={() => void toggle("screen")}
        />

        <Control
          label={layout === "grid" ? "Switch to speaker view" : "Switch to grid view"}
          icon={layout === "grid" ? SquareIcon : GridViewIcon}
          active={false}
          disabled={false}
          onClick={() => onLayoutChange(layout === "grid" ? "spotlight" : "grid")}
        />
        <div className="relative">
          <Control
            label="Audio and video settings"
            icon={Settings02Icon}
            active={false}
            disabled={false}
            onClick={() => setSettingsOpen((open) => !open)}
          />
          {settingsOpen ? (
            <DeviceSettings onClose={() => setSettingsOpen(false)} />
          ) : null}
        </div>
        <span aria-hidden className="mx-1 h-6 w-px bg-hairline" />
        {isHost ? (
          <button
            type="button"
            onClick={() => void endForAll()}
            disabled={busy}
            className={cn(
              "flex h-11 items-center rounded-full border px-4 text-sm font-medium transition-colors disabled:opacity-40",
              confirmingEnd
                ? "border-ember bg-ember text-white"
                : "border-ember text-ember hover:bg-ember/10",
            )}
          >
            {confirmingEnd ? "End for everyone?" : "End for all"}
          </button>
        ) : null}

        {/* The accent is spent here: leaving is the one irreversible thing in
            the room, and the only control that should be findable at a glance. */}
        <button
          type="button"
          onClick={() => void leave()}
          disabled={busy}
          aria-label="Leave meeting"
          className="flex h-11 items-center gap-2 rounded-full bg-ember px-5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          <Icon icon={CallEnd01Icon} size={17} strokeWidth={1.8} />
          Leave
        </button>
      </div>
      {endError || deviceError ? (
        <p
          role="alert"
          className="absolute bottom-full mb-2 max-w-[calc(100%-1.5rem)] rounded-full bg-canvas px-3 py-1 text-center text-xs text-ember"
        >
          {endError ?? deviceError}
        </p>
      ) : null}
    </div>
  )
}
