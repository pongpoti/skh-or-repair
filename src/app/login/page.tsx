import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { LiffSignIn } from "@/components/liff-sign-in";
import { getAccessGrant, getUser } from "@/lib/auth/server";
import { isListedUser } from "@/lib/authz";
import { gateMode, liffId } from "@/lib/gate";
import { safeNextPath } from "@/lib/security";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; signed_out?: string | string[] }> }) {
  const sp = await searchParams;
  const next = safeNextPath(typeof sp.next === "string" ? sp.next : undefined);
  if (await getUser()) redirect(next);
  // A verified number with a name still to pick on this browser. Nothing when the number holds a name by now (claimed
  // on another device, or set by hand): signing in with LINE is the way on, and the name page would lead back here.
  const grant = await getAccessGrant();
  if (grant && !(await isListedUser(grant.phone))) {
    return (
      <AuthShell title="เข้าสู่ระบบ" description="ยืนยันเบอร์มือถือแล้ว ทำต่อจากขั้นที่ค้างไว้">
        <a className="btn btn-primary min-h-12 w-full" href="/login/claim" data-testid="claim-resume-link">
          เลือกชื่อของคุณต่อ
        </a>
      </AuthShell>
    );
  }

  // Signing out lands here; signing straight back in would undo it. The next visit from the LINE menu signs in again.
  if (sp.signed_out !== undefined) {
    return <AuthShell title="ออกจากระบบแล้ว" description="เปิดใหม่ได้จากเมนูใน LINE" />;
  }

  // There is no sign-in button: people open the board from the LINE menu, and LINE has already signed them in there.
  // Inside the LIFF app (the only place the gate lets this page render on Vercel) the LIFF SDK signs in without leaving
  // the app (see LiffSignIn). Anywhere else (no LIFF ID, local development, the CLIENT_GATE=off break-glass) LINE
  // Login's web redirect does it.
  const liff = gateMode() === "liff" ? liffId() : null;
  if (!liff) redirect(next === "/" ? "/api/auth/line/start" : `/api/auth/line/start?next=${encodeURIComponent(next)}`);
  return (
    <AuthShell title="เข้าสู่ระบบ">
      <LiffSignIn liffId={liff} next={next} />
    </AuthShell>
  );
}
