"use server"

import { revalidatePath } from "next/cache"
import { auth } from "@clerk/nextjs/server"

import { apiFetch } from "@/lib/api"

export type CreateMeetingState = {
  error: string | null
  /** The code of the meeting just created, or null before the first attempt. */
  code: string | null
}

/**
 * Starting a meeting takes no input: the API generates the code.
 *
 * The code comes back rather than the host being redirected into the room, so
 * the link can be shown and copied first — sharing it is the point of creating
 * a meeting, and a host who has already been dropped into an empty call has to
 * go looking for it.
 */
export async function createMeetingAction(
  _previous: CreateMeetingState,
): Promise<CreateMeetingState> {
  await auth.protect()

  try {
    const created = await apiFetch<{ code: string }>("/meetings", {
      method: "POST",
      body: JSON.stringify({}),
    })

    revalidatePath("/dashboard")
    return { error: null, code: created.code }
  } catch {
    return { error: "Could not start the meeting. Is the API running?", code: null }
  }
}
