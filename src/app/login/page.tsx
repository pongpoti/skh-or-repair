import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { LiffSignIn } from "@/components/liff-sign-in";
import { getAccessGrant, getUser } from "@/lib/auth/server";
import { isListedUser } from "@/lib/authz";
import { gateMode, isLiff, liffId } from "@/lib/gate";
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

  const inLiff = isLiff((await headers()).get("user-agent") ?? "");

  // Signing out lands here; signing straight back in would undo it. In LINE the next visit from the menu signs in
  // again. A computer has no LINE menu, so it gets a way back to the board (which signs in again through LINE's page).
  if (sp.signed_out !== undefined) {
    if (inLiff) return <AuthShell title="ออกจากระบบแล้ว" description="เปิดใหม่ได้จากเมนูใน LINE" />;
    return (
      <AuthShell title="ออกจากระบบแล้ว">
        <Link className="btn btn-secondary min-h-12 w-full" href="/" data-testid="signed-out-reopen">
          เปิดตารางห้องผ่าตัดอีกครั้ง
        </Link>
      </AuthShell>
    );
  }

  // There is no sign-in button. On a phone people open the board from the LINE menu, and LINE has already signed them
  // in there: inside the LIFF app the LIFF SDK signs in without leaving the app (see LiffSignIn). Anywhere else (a
  // computer or tablet, no LIFF ID, local development, the CLIENT_GATE=off break-glass) LINE Login's web page does it,
  // on a computer starting with the QR code the LINE app on the phone scans.
  const liff = gateMode() === "liff" && inLiff ? liffId() : null;
  if (!liff) redirect(next === "/" ? "/api/auth/line/start" : `/api/auth/line/start?next=${encodeURIComponent(next)}`);
  return (
    <AuthShell title="เข้าสู่ระบบ">
      <LiffSignIn liffId={liff} next={next} />
    </AuthShell>
  );
}
