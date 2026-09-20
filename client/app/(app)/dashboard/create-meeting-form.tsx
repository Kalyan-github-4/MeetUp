"use client"

import { useActionState } from "react"
import Link from "next/link"

import { meetingPath } from "@/lib/meeting-url"
import { MeetingLinkField } from "@/components/meeting/share-link"
import { Button, buttonVariants } from "@/components/ui/button"
import {
  createMeetingAction,
  type CreateMeetingState,
} from "@/app/(app)/dashboard/actions"

const initialState: CreateMeetingState = { error: null, code: null }

export function CreateMeetingForm() {
  const [state, formAction, pending] = useActionState(
    createMeetingAction,
    initialState,
  )

  return (
    <div className="flex flex-col gap-4">
      <form action={formAction}>
        <Button type="submit" disabled={pending} size="lg" className="w-full">
          {pending ? "Starting…" : "New meeting"}
        </Button>
      </form>

      {state.error ? (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      {state.code ? (
        // Announced, because the button the host pressed is the thing that
        // stays put while this appears underneath it.
        <section
          aria-live="polite"
          className="rounded-2xl border p-5"
        >
          <h2 className="text-sm font-medium">Your meeting is ready</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Send this link to the people you want in the meeting. Anyone who
            opens it can enter their name and ask to join.
          </p>

          <MeetingLinkField code={state.code} className="mt-4" />

          <Link
            href={meetingPath(state.code)}
            className={buttonVariants({ variant: "outline", className: "mt-4" })}
          >
            Join now
          </Link>
        </section>
      ) : null}
    </div>
  )
}
