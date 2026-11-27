/**
 * The calendar API's paths (lib/calendar-api.ts), which the proxy (src/proxy.ts) lets through without a session, the
 * Origin check and the device gate: the route checks the calendar's key itself. Exactly the list and one record by the
 * calendar's id (1 to 15 digits, no leading zero), nothing under or beside them, so no page or other route can fall in
 * by accident. Dependency-free: the proxy imports it.
 */
export const CALENDAR_API_PATH = "/api/v1/calendar/cases";

const PATH = /^\/api\/v1\/calendar\/cases(?:\/[1-9][0-9]{0,14})?$/;

export function isCalendarApiPath(pathname: string): boolean {
  return PATH.test(pathname);
}
