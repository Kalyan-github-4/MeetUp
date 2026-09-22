"use client"

import { VideoTrack, type TrackReference } from "@livekit/components-react"
import { Mic01Icon, MicOff01Icon } from "@hugeicons/core-free-icons"
import { cn } from "cn"

import { Icon } from "@/components/ui/icon"
import { InitialsAvatar } from "@/components/meeting/initials-avatar"

export type Tile = {
  /** Participant identity — the participant row id issued at join. */
  id: string
  name: string
  isLocal: boolean
  micOn: boolean
  isSpeaking: boolean
  /** Absent when the camera is off, so the tile falls back to their initials. */
  video: TrackReference | null
  /** A shared screen rather than a person. */
  isScreen?: boolean
}

/** Stands in for the camera feed, filling the tile the way video would. */
function CameraOff({ tile }: { tile: Tile }) {
  return (
    <InitialsAvatar name={tile.name} className="absolute inset-0 size-full" />
  )
}

/**
 * Badges and labels that sit over video keep their own dark treatment — a
 * hairline would vanish against whatever the camera happens to be pointing at.
 */
function MicBadge({ micOn }: { micOn: boolean }) {
  return (
    <span
      title={micOn ? "Microphone on" : "Microphone muted"}
      className="inline-flex size-7 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-md"
    >
      <span className="sr-only">
        {micOn ? "Microphone on" : "Microphone muted"}
      </span>
      <Icon icon={micOn ? Mic01Icon : MicOff01Icon} size={12} strokeWidth={2} />
    </span>
  )
}

/** The large tile: the active speaker, or whoever is sharing their screen. */
export function LiveStage({
  tile,
  className,
  children,
}: {
  tile: Tile | null
  className?: string
  children?: React.ReactNode
}) {
  return (
    <div
      className={cn(
        "relative isolate min-h-72 flex-1 overflow-hidden rounded-2xl border border-hairline bg-ink/3",
        className,
      )}
    >
      {tile === null ? (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-muted">
          Waiting for someone to join…
        </div>
      ) : tile.video ? (
        <VideoTrack
          trackRef={tile.video}
          className={cn(
            "absolute inset-0 size-full",
            tile.isScreen ? "object-contain" : "object-cover",
          )}
        />
      ) : (
        <CameraOff tile={tile} />
      )}

      {tile ? (
        <>
          <div
            aria-hidden
            className="absolute inset-x-0 top-0 h-28 bg-linear-to-b from-black/45 to-transparent"
          />
          <div className="absolute top-5 left-5 z-10 text-white">
            <p className="text-[10px] tracking-[0.18em] text-white/70 uppercase">
              {tile.isScreen ? "Presenting" : tile.isLocal ? "You" : "Speaking"}
            </p>
            <p className="mt-1 text-lg font-medium tracking-tight">
              {tile.name}
            </p>
          </div>
        </>
      ) : null}

      {children}
    </div>
  )
}

/**
 * One small tile: video or initials, name, mic state. Shared by the strip and
 * the grid so both read the same way.
 */
function TileBody({ tile }: { tile: Tile }) {
  return (
    <>
      {tile.video ? (
        <VideoTrack
          trackRef={tile.video}
          className={cn(
            "absolute inset-0 size-full",
            // A shared screen is letterboxed: cropping it would hide the edge
            // of whatever is being presented.
            tile.isScreen ? "object-contain" : "object-cover",
          )}
        />
      ) : (
        <CameraOff tile={tile} />
      )}

      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-14 bg-linear-to-t from-black/55 to-transparent"
      />

      <div className="absolute inset-x-3 bottom-2.5 flex items-end justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-medium text-white">
          {tile.isLocal && !tile.isScreen ? `${tile.name} (you)` : tile.name}
        </p>
        {tile.isScreen ? null : <MicBadge micOn={tile.micOn} />}
      </div>
    </>
  )
}

function tileFrame(tile: Tile): string {
  return cn(
    "relative overflow-hidden rounded-xl border bg-ink/3",
    // The accent marks who is talking — the one thing in the room that
    // changes on its own and is worth the eye being pulled to.
    tile.isSpeaking ? "border-ember" : "border-hairline",
  )
}

/** The rail of everyone who is not on the stage. */
export function LiveParticipantStrip({ tiles }: { tiles: Tile[] }) {
  if (tiles.length === 0) return null

  return (
    <div className="flex gap-3 overflow-x-auto lg:w-44 lg:shrink-0 lg:flex-col lg:overflow-x-visible lg:overflow-y-auto">
      {tiles.map((tile) => (
        <div
          key={tile.id}
          className={cn(tileFrame(tile), "aspect-4/3 w-40 shrink-0 lg:w-full")}
        >
          <TileBody tile={tile} />
        </div>
      ))}
    </div>
  )
}

/**
 * Columns for a given head count: as square a grid as fits, so tiles stay
 * large. Phones get at most two columns, wide screens up to four.
 */
function gridColumns(count: number): string {
  if (count <= 1) return "grid-cols-1"
  if (count <= 4) return "grid-cols-1 sm:grid-cols-2"
  if (count <= 9) return "grid-cols-2 lg:grid-cols-3"
  return "grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
}

/**
 * Everyone at the same size. A shared screen, when there is one, leads and
 * spans two columns so it stays readable among the faces.
 */
export function LiveGrid({
  tiles,
  children,
}: {
  tiles: Tile[]
  children?: React.ReactNode
}) {
  return (
    <div className="relative isolate flex min-h-72 flex-1 flex-col overflow-hidden rounded-2xl border border-hairline">
      <div
        className={cn(
          "grid flex-1 auto-rows-fr content-center gap-3 overflow-y-auto p-3 pb-24",
          gridColumns(tiles.length),
        )}
      >
        {tiles.map((tile) => (
          <div
            key={tile.id}
            className={cn(
              tileFrame(tile),
              "min-h-36",
              tile.isScreen && tiles.length > 1 && "sm:col-span-2",
            )}
          >
            <TileBody tile={tile} />
          </div>
        ))}
      </div>

      {children}
    </div>
  )
}
