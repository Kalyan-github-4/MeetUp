"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  Mic01Icon,
  MicOff01Icon,
  Video01Icon,
  VideoOffIcon,
  VolumeHighIcon,
} from "@hugeicons/core-free-icons"
import { cn } from "cn"

import type { MediaPrefs } from "@/lib/media-prefs"
import { DeviceSelect } from "@/components/meeting/device-select"
import { Icon } from "@/components/ui/icon"

/**
 * A device the browser may open, preferring the one chosen before. `ideal`
 * rather than `exact`: a headset unplugged since last time falls back to the
 * default instead of failing the whole preview.
 */
function constraint(deviceId: string | undefined): MediaTrackConstraints {
  return deviceId ? { deviceId: { ideal: deviceId } } : {}
}

function describe(error: unknown, device: "camera" | "microphone"): string {
  const name = error instanceof DOMException ? error.name : ""
  if (name === "NotAllowedError") {
    return `Your ${device} is blocked. Allow it from the icon in the address bar, then turn it back on.`
  }
  if (name === "NotFoundError" || name === "OverconstrainedError") {
    return `No ${device} was found.`
  }
  if (name === "NotReadableError") {
    return `Your ${device} is in use by another app.`
  }
  return `Could not start your ${device}.`
}

function stop(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop())
}

/**
 * Opens one kind of device while `enabled`, and closes it when disabled,
 * switched or unmounted. Camera and mic are opened separately so turning one
 * off never makes the other blink.
 */
function useDeviceStream(
  kind: "video" | "audio",
  enabled: boolean,
  deviceId: string | undefined,
  onError: (error: unknown) => void,
  onOpened: () => void,
): MediaStream | null {
  const [stream, setStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    if (!enabled) return

    let cancelled = false
    let opened: MediaStream | null = null

    navigator.mediaDevices
      .getUserMedia({ [kind]: constraint(deviceId) })
      .then((acquired) => {
        if (cancelled) {
          stop(acquired)
          return
        }
        opened = acquired
        setStream(acquired)
        onOpened()
      })
      .catch((error: unknown) => {
        if (!cancelled) onError(error)
      })

    return () => {
      cancelled = true
      stop(opened)
    }
  }, [kind, enabled, deviceId, onError, onOpened])

  // A stream left over from before the device was turned off is already
  // stopped by the cleanup above; it must not be handed out as live.
  return enabled ? stream : null
}

/** Device lists, refreshed when permission lands or hardware is plugged in. */
function useDevices(): {
  devices: MediaDeviceInfo[]
  refresh: () => void
} {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])

  const refresh = useCallback(() => {
    navigator.mediaDevices
      ?.enumerateDevices()
      .then(setDevices)
      .catch(() => {
        // Without a list the selects show the system default, which works.
      })
  }, [])

  useEffect(() => {
    refresh()
    navigator.mediaDevices?.addEventListener("devicechange", refresh)
    return () =>
      navigator.mediaDevices?.removeEventListener("devicechange", refresh)
  }, [refresh])

  return { devices, refresh }
}

/**
 * Drives a level bar straight from the analyser, bypassing React: it changes
 * sixty times a second, and re-rendering the form at that rate buys nothing.
 */
function useMicLevel(stream: MediaStream | null) {
  const barRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const bar = barRef.current
    if (!stream || !bar) return

    const context = new AudioContext()
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    context.createMediaStreamSource(stream).connect(analyser)
    const samples = new Uint8Array(analyser.frequencyBinCount)

    let frame = 0
    const tick = () => {
      analyser.getByteTimeDomainData(samples)
      let peak = 0
      for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128))
      // Speech rarely peaks past half scale, so stretch it to fill the bar.
      bar.style.transform = `scaleX(${Math.min(1, (peak / 128) * 2.2)})`
      frame = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(frame)
      bar.style.transform = "scaleX(0)"
      void context.close()
    }
  }, [stream])

  return barRef
}

function Toggle({
  on,
  onLabel,
  offLabel,
  onIcon,
  offIcon,
  onClick,
}: {
  on: boolean
  onLabel: string
  offLabel: string
  onIcon: typeof Mic01Icon
  offIcon: typeof Mic01Icon
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={on ? onLabel : offLabel}
      className={cn(
        "flex size-10 items-center justify-center rounded-full border backdrop-blur-md transition-colors",
        on
          ? "border-white/30 bg-black/40 text-white hover:bg-black/55"
          : "border-ember bg-ember text-white hover:opacity-90",
      )}
    >
      <Icon icon={on ? onIcon : offIcon} size={17} strokeWidth={1.8} />
    </button>
  )
}

/**
 * The camera and microphone check before joining.
 *
 * Shows the camera when it is on and `fallback` (their initials) when it
 * is off — the same thing everyone else will see. The streams opened here are
 * released on join; the room opens its own with the same choices.
 */
export function DevicePreview({
  prefs,
  onChange,
  fallback,
  footer,
}: {
  prefs: MediaPrefs
  onChange: (change: Partial<MediaPrefs>) => void
  fallback: ReactNode
  footer?: ReactNode
}) {
  const { devices, refresh } = useDevices()
  const [error, setError] = useState<string | null>(null)

  // A device that fails to open is switched off, so the room does not try the
  // same failing device again the moment they join.
  const onCameraError = useCallback(
    (cause: unknown) => {
      setError(describe(cause, "camera"))
      onChange({ camOn: false })
    },
    [onChange],
  )
  const onMicError = useCallback(
    (cause: unknown) => {
      setError(describe(cause, "microphone"))
      onChange({ micOn: false })
    },
    [onChange],
  )

  const video = useDeviceStream("video", prefs.camOn, prefs.videoInputId, onCameraError, refresh)
  const audio = useDeviceStream("audio", prefs.micOn, prefs.audioInputId, onMicError, refresh)
  const levelRef = useMicLevel(audio)

  const videoRef = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = video
  }, [video])

  const cameras = devices.filter((d) => d.kind === "videoinput")
  const mics = devices.filter((d) => d.kind === "audioinput")
  // Choosing an output device is Chromium-only; elsewhere the list is empty or
  // the choice would be silently ignored, so the select is not offered at all.
  const speakers =
    typeof HTMLMediaElement !== "undefined" &&
    "setSinkId" in HTMLMediaElement.prototype
      ? devices.filter((d) => d.kind === "audiooutput")
      : []

  return (
    <div>
      <div className="overflow-hidden rounded-2xl border border-hairline">
        <div className="relative isolate aspect-4/3 w-full bg-ink/3">
          {prefs.camOn && video ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              aria-label="Your camera preview"
              // Mirrored, like a mirror — what people expect of their own face.
              className="absolute inset-0 size-full -scale-x-100 object-cover"
            />
          ) : prefs.camOn ? (
            <div aria-hidden className="absolute inset-0 animate-pulse bg-ink/5" />
          ) : (
            fallback
          )}

          <div className="absolute inset-x-0 bottom-3 z-10 flex items-center justify-center gap-2">
            <Toggle
              on={prefs.micOn}
              onLabel="Turn microphone off"
              offLabel="Turn microphone on"
              onIcon={Mic01Icon}
              offIcon={MicOff01Icon}
              onClick={() => {
                setError(null)
                onChange({ micOn: !prefs.micOn })
              }}
            />
            <Toggle
              on={prefs.camOn}
              onLabel="Turn camera off"
              offLabel="Turn camera on"
              onIcon={Video01Icon}
              offIcon={VideoOffIcon}
              onClick={() => {
                setError(null)
                onChange({ camOn: !prefs.camOn })
              }}
            />
          </div>

          {prefs.micOn ? (
            <span
              aria-hidden
              className="absolute top-3 left-3 z-10 h-1 w-16 overflow-hidden rounded-full bg-black/30"
            >
              <span
                ref={levelRef}
                className="block h-full origin-left scale-x-0 bg-white transition-transform duration-75"
              />
            </span>
          ) : null}
        </div>

        {footer}
      </div>

      {error ? (
        <p role="alert" className="mt-2.5 text-sm text-ember">
          {error}
        </p>
      ) : null}

      <div className="mt-3 grid gap-2">
        <DeviceSelect
          label="Microphone"
          icon={Mic01Icon}
          devices={mics}
          value={prefs.audioInputId ?? ""}
          onChange={(id) => onChange({ audioInputId: id || undefined })}
        />
        <DeviceSelect
          label="Camera"
          icon={Video01Icon}
          devices={cameras}
          value={prefs.videoInputId ?? ""}
          onChange={(id) => onChange({ videoInputId: id || undefined })}
        />
        {speakers.length > 0 ? (
          <DeviceSelect
            label="Speaker"
            icon={VolumeHighIcon}
            devices={speakers}
            value={prefs.audioOutputId ?? ""}
            onChange={(id) => onChange({ audioOutputId: id || undefined })}
          />
        ) : null}
      </div>
    </div>
  )
}
