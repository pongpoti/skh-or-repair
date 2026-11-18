import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { VerifiedIdentity } from "@/components/verified-identity";
import { getAccessGrant, getUser } from "@/lib/auth/server";
import { isListedUser } from "@/lib/authz";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { claimUndoAvailable } from "@/lib/telegram";
import { isPhoneType } from "@/lib/user-labels";
import { claimBlocked, type ClaimBlock } from "@/lib/user-list";
import { H2, HELP, StateIcon } from "../shared";
import { ClaimPanel, type ClaimStart } from "./claim-panel";

export const dynamic = "force-dynamic";

/**
 * After the SMS code, a verified number that holds no name picks its own name from the staff list (`users`): the
 * position chosen before the number (?type=RN|PN|PCA) opens its names at once. The first claim wins, and a claimed name
 * is locked for everyone else (shown as taken). There is no other way in: no typed names. Doctors are sent to the email
 * sign-in (/login/doctor).
 */
export default async function ClaimPage({ searchParams }: { searchParams: Promise<{ type?: string | string[] }> }) {
  if (await getUser()) redirect("/");
  const grant = await getAccessGrant();
  if (!grant) redirect("/login");
  const phone = formatPhone(grant.phone);

  // Holds a name now (claimed on another device, or set by hand): LINE signs it in.
  if (await isListedUser(grant.phone)) {
    return (
      <AuthShell title="ยืนยันชื่อของคุณ">
        <VerifiedIdentity lineName={grant.name} picture={grant.picture} phone={phone} />
        <div className="mt-6 text-center" data-testid="claim-signin">
          <StateIcon icon="check" tone="ok" />
          <h2 className={H2}>เบอร์นี้มีชื่อในระบบแล้ว</h2>
          <p className={HELP}>เข้าสู่ระบบอีกครั้ง</p>
          <a className="btn btn-primary mt-4 min-h-12 w-full" href="/login">
            เข้าสู่ระบบ
          </a>
        </div>
      </AuthShell>
    );
  }

  let start: ClaimStart = "pick";
  let blockedBy: ClaimBlock | null = null;
  try {
    blockedBy = await claimBlocked(await db(), grant.phone, grant.sub);
    if (blockedBy) start = "blocked";
  } catch (e) {
    console.error("[claim] claim page:", (e as Error).message);
    start = "error";
  }
  const type = (await searchParams).type;
  return (
    <AuthShell title="ยืนยันชื่อของคุณ">
      <VerifiedIdentity lineName={grant.name} picture={grant.picture} phone={phone} />
      <div className="mt-6">
        <ClaimPanel
          start={start}
          blockedBy={blockedBy}
          phone={phone}
          initialType={isPhoneType(type) ? type : null}
          undo={claimUndoAvailable()}
        />
      </div>
    </AuthShell>
  );
}
