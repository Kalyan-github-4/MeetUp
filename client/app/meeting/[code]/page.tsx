import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { currentUser } from "@clerk/nextjs/server"

import { apiFetch, ApiError } from "@/lib/api"
import { ChatPanel } from "@/components/meeting/chat-panel"
import { LiveMeetingRoom } from "@/components/meeting/live-room"
import { PreJoin } from "@/components/meeting/pre-join"

export const metadata: Metadata = {
  title: "Meeting Room · MeetUp",
  description: "Live meeting room with video, screen share and chat.",
}

type MeetingResponse = {
  id: string
  code: string
  title: string
  status: "scheduled" | "live" | "ended"
  host: { id: string; name: string | null }
}

export default async function MeetingRoomPage({
  params,
}: PageProps<"/meeting/[code]">) {
  const { code: rawCode } = await params
  const code = decodeURIComponent(rawCode)

  let meeting: MeetingResponse
  try {
    meeting = await apiFetch<MeetingResponse>(
      `/meetings/${encodeURIComponent(code)}`,
    )
  } catch (error) {
    if (error instanceof ApiError && error.status === 404) notFound()
    throw error
  }

  const user = await currentUser()
  const signedInName =
    [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null

  // The summary and task panel is out until Phase 6 gives it something real to
  // show — `summary-panel.tsx` is still there, waiting to be handed live data.
  // Below `lg` the room is not height-constrained, so the panel is given an
  // explicit height of its own — otherwise the message list grows the page
  // instead of scrolling inside itself.
  const sidePanels = (
    <ChatPanel code={code} className="h-[70vh] min-h-96 lg:h-auto lg:flex-1" />
  )

  return (
    <PreJoin
      code={code}
      title={meeting.title}
      hostName={meeting.host.name}
      signedInName={signedInName}
    >
      <LiveMeetingRoom
        code={code}
        title={meeting.title}
        subtitle={
          meeting.host.name ? `${meeting.host.name}'s meeting` : "MeetUp meeting"
        }
        sidePanels={sidePanels}
      />
    </PreJoin>
  )
}
