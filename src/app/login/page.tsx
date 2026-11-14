import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { LineLoginButton } from "@/components/line-login-button";
import { LiffSignIn } from "@/components/liff-sign-in";
import { latestRequest, viewFor } from "@/lib/access";
import { getAccessGrant, getUser } from "@/lib/auth/server";
import { isListedUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { gateMode, liffId } from "@/lib/gate";
import { safeNextPath } from "@/lib/security";
import { claimsEnabled } from "@/lib/telegram";

/**
 * Where a browser with a verified number continues: its access request, or picking its name (only while claims are
 * open). Nothing when the number holds a name by now (claimed on another device, or set by hand): signing in with LINE,
 * the primary button, is the way on, and the claim or request pages would only lead back here.
 */
async function continueAt(phone: string, sub: string): Promise<"request" | "claim" | null> {
  if (await isListedUser(phone)) return null;
  try {
    return claimsEnabled() && viewFor(await latestRequest(await db(), phone), sub) === "form" ? "claim" : "request";
  } catch {
    return "request"; // that page reports the outage
  }
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; signed_out?: string | string[] }> }) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined);
  if (await getUser()) redirect(next);
  // A verified number that is not authorized yet (a name to pick, or an access request in progress, on this browser).
  const grant = await getAccessGrant();
  const resume = grant ? await continueAt(grant.phone, grant.sub) : null;
  // Inside the LIFF app (the only place the gate lets this page render on Vercel) LINE has already signed the user in,
  // so sign in straight away instead of showing a button to tap, through the LIFF SDK so the app never leaves for
  // LINE Login's web page (see LiffSignIn). Not after signing out (that would sign straight back in) and not while
  // this browser has a name to pick or an access request to follow.
  const liff = gateMode() === "liff" ? liffId() : null;
  const auto = !resume && sp.signed_out === undefined;
  if (gateMode() === "liff" && !liff && auto) {
    redirect(next === "/" ? "/api/auth/line/start" : `/api/auth/line/start?next=${encodeURIComponent(next)}`);
  }

  return (
    <AuthShell title="ตารางห้องผ่าตัด" description="เข้าสู่ระบบเพื่อดูเคสผ่าตัดของวันนี้">
      {liff ? <LiffSignIn liffId={liff} next={next} auto={auto} /> : <LineLoginButton next={next} />}
      <p className="mt-4 text-center text-sm leading-6 text-muted">
        สำหรับเจ้าหน้าที่ห้องผ่าตัดที่ได้รับอนุญาตเท่านั้น
        <br />
        ครั้งแรกต้องยืนยันเบอร์มือถือด้วยรหัสทาง SMS
        <br />
        แพทย์ยืนยันด้วยรหัสทางอีเมล
      </p>
      {resume === "request" ? (
        <a className="btn btn-secondary mt-4 w-full" href="/login/request" data-testid="request-status-link">
          ดูสถานะคำขอเข้าใช้งาน
        </a>
      ) : resume === "claim" ? (
        <a className="btn btn-secondary mt-4 w-full" href="/login/claim" data-testid="claim-resume-link">
          เลือกชื่อของคุณต่อ
        </a>
      ) : null}
    </AuthShell>
  );
}
