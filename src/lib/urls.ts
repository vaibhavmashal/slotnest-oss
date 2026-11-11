/** A full https:// address with a host (for redirects and webhooks people paste in). */
export function isHttpsUrl(value: string): boolean {
  if (value.length > 2000) return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** The redirect address after a booking, with the invitee's details added when the event type asks for it. */
export function bookingRedirect(
  base: string,
  passDetails: boolean,
  details: { name: string; email: string; start: string; end: string; eventTitle: string },
): string {
  const u = new URL(base);
  if (passDetails) {
    u.searchParams.set("name", details.name);
    u.searchParams.set("email", details.email);
    u.searchParams.set("start", details.start);
    u.searchParams.set("end", details.end);
    u.searchParams.set("event", details.eventTitle);
  }
  return u.toString();
}
