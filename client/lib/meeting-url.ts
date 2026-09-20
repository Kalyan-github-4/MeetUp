/**
 * Where a meeting lives, as a URL.
 *
 * The code is the whole identity of a meeting — it is generated once when the
 * meeting is created and never changes, so the link built from it stays valid
 * for as long as the meeting does and can be opened by any number of people.
 */

/** The in-app path for a meeting. Encoded, because the code sits in the path. */
export function meetingPath(code: string): string {
  return `/meeting/${encodeURIComponent(code)}`
}

/**
 * The absolute link to hand to someone else.
 *
 * `origin` is passed in rather than read here because the only reliable source
 * for it is the browser — see `useMeetingUrl`.
 */
export function meetingUrl(code: string, origin: string): string {
  // A trailing slash on the origin would double up against the leading one on
  // the path, and some hosts set the variable that way.
  return `${origin.replace(/\/+$/, "")}${meetingPath(code)}`
}
