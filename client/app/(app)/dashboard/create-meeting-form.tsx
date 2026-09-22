"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import {
  createMeetingAction,
  type CreateMeetingState,
} from "@/app/(app)/dashboard/actions"

const initialState: CreateMeetingState = { error: null }

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
    </div>
  )
}
