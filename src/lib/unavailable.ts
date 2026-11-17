/**
 * The outage page (Pong, 17 Nov 2026: "for server, network, connection error, redirect to another landing page"):
 * /unavailable?reason=server|network&from=/path. `from` is where "ลองอีกครั้ง" goes back to; the page checks it with
 * safeNextPath() (lib/security.ts), so it is always a path on this site. The page needs no session and no database
 * (src/proxy.ts). This file is used by the browser too (the error boundaries), so it imports nothing server-only.
 */
export const UNAVAILABLE_PATH = "/unavailable";

export type OutageReason = "server" | "network";

export function outageReason(input: unknown): OutageReason {
  return input === "network" ? "network" : "server";
}

export function unavailablePath(reason: OutageReason, from?: string): string {
  const q = new URLSearchParams({ reason });
  if (from && from.startsWith("/") && from !== "/" && !isOutagePage(from)) q.set("from", from);
  return `${UNAVAILABLE_PATH}?${q}`;
}

export function isOutagePage(path: string): boolean {
  return path === UNAVAILABLE_PATH || path.startsWith(`${UNAVAILABLE_PATH}?`) || path.startsWith(`${UNAVAILABLE_PATH}/`);
}

/** The words on the page, for each reason. */
export const OUTAGE_TEXT: Record<OutageReason, { title: string; description: string; hint: string }> = {
  server: {
    title: "ระบบขัดข้องชั่วคราว",
    description: "เซิร์ฟเวอร์หรือฐานข้อมูลไม่ตอบสนองในขณะนี้",
    hint: "ข้อมูลที่บันทึกไว้แล้วไม่หายไป ลองอีกครั้งในอีกสักครู่",
  },
  network: {
    title: "ไม่มีการเชื่อมต่ออินเทอร์เน็ต",
    description: "อุปกรณ์นี้ติดต่อระบบไม่ได้ในขณะนี้",
    hint: "ตรวจสอบ Wi-Fi หรืออินเทอร์เน็ตมือ\u2060ถือ หน้านี้จะกลับไปเองเมื่อเชื่อมต่อได้",
  },
};
