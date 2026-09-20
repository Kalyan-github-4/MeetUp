import type { Metadata } from "next"
import Link from "next/link"
import { UserButton } from "@clerk/nextjs"
import { auth } from "@clerk/nextjs/server"

import { apiFetch } from "@/lib/api"
import { meetingPath } from "@/lib/meeting-url"
import { CopyLinkButton } from "@/components/meeting/share-link"
import { CreateMeetingForm } from "@/app/(app)/dashboard/create-meeting-form"

export const metadata: Metadata = {
  title: "Dashboard · MeetUp",
}

type MeetingsResponse = {
  meetings: {
    id: string
    code: string
    title: string
    status: "scheduled" | "live" | "ended"
    createdAt: string
  }[]
}

const statusStyles: Record<string, string> = {
  live: "bg-green-100 text-green-800",
  scheduled: "bg-blue-100 text-blue-800",
  ended: "bg-neutral-100 text-neutral-600",
}

export default async function DashboardPage() {
  // The group layout also protects this route, but layouts and pages render in
  // parallel — without this the fetch below would still fire (and fail) on the
  // way to the redirect. Guard the data, not just the path.
  await auth.protect()

  const { meetings } = await apiFetch<MeetingsResponse>("/meetings")

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Meetings</h1>
          <p className="text-sm text-muted-foreground">
            Start a meeting and share the link.
          </p>
        </div>
        <UserButton />
      </header>

      <CreateMeetingForm />

      {meetings.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          No meetings yet. Your first one will show up here.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {meetings.map((meeting) => (
            <li
              key={meeting.id}
              className="flex items-center gap-3 rounded-lg border p-4 transition-colors hover:bg-muted"
            >
              {/* Only the title is the link: the copy button beside it is a
                  control of its own, and a button inside a link is neither. */}
              <Link href={meetingPath(meeting.code)} className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {meeting.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {meeting.status === "ended"
                    ? "Ended"
                    : "Open to anyone with the link"}
                </span>
              </Link>

              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  statusStyles[meeting.status] ?? statusStyles.ended
                }`}
              >
                {meeting.status}
              </span>

              {/* An ended meeting cannot be rejoined, so there is nothing
                  useful left to hand anyone. */}
              {meeting.status === "ended" ? null : (
                <CopyLinkButton code={meeting.code} className="shrink-0" />
              )}
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}
