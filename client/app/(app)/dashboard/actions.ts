"use server"

import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { auth } from "@clerk/nextjs/server"

import { apiFetch } from "@/lib/api"
import { meetingPath } from "@/lib/meeting-url"

export type CreateMeetingState = {
  error: string | null
}

/**
 * Starting a meeting takes no input: the API generates the code, and the host
 * goes straight into the room, where the link to share sits at the top.
 */
export async function createMeetingAction(
  _previous: CreateMeetingState,
): Promise<CreateMeetingState> {
  await auth.protect()

  let code: string
  try {
    const created = await apiFetch<{ code: string }>("/meetings", {
      method: "POST",
      body: JSON.stringify({}),
    })
    code = created.code
  } catch {
    return { error: "Could not start the meeting. Is the API running?" }
  }

  revalidatePath("/dashboard")
  // Outside the try: `redirect` works by throwing, which the catch would eat.
  redirect(meetingPath(code))
}
