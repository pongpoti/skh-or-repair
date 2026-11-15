import { redirect } from "next/navigation";
import { AuthShell, LineIdentity } from "@/components/auth-shell";
import { ProfileAvatar } from "@/components/profile-avatar";
import { getAccessGrant, getPendingLogin, getUser } from "@/lib/auth/server";
import { avatarSrc, initialOf } from "@/lib/avatar";
import { db } from "@/lib/db";
import { listDoctors } from "@/lib/email-otp";
import { subtypeLabel } from "@/lib/user-labels";
import { DoctorPanel, type DoctorChoice } from "./doctor-panel";

export const dynamic = "force-dynamic";

/**
 * Doctors sign in only with a code sent to their own email (lib/email-otp.ts), never by SMS: after LINE, the doctor
 * picks their name, the code goes to every address on file for it, and typing it in signs this LINE account in as that
 * doctor (next time, LINE alone for 180 days). Reached from the position step (/login/verify, pending cookie), or from
 * the name page after an SMS code (access cookie). The list carries names and specialties only, whether an address is
 * on file (never the address), and whether another LINE account holds the name (then it cannot be picked).
 */
export default async function DoctorPage() {
  if (await getUser()) redirect("/");
  const pending = await getPendingLogin();
  const who = pending ?? (await getAccessGrant());
  if (!who) redirect("/login");

  let names: DoctorChoice[] | null = null;
  try {
    names = (await listDoctors(await db(), who.sub)).map((n) => ({
      id: n.id,
      first_name: n.first_name,
      last_name: n.last_name,
      subtype_label: subtypeLabel("DR", n.subtype),
      has_email: n.has_email,
      claimed: n.claimed,
    }));
  } catch (e) {
    console.error("[email-otp] doctor list:", (e as Error).message);
  }
  // The LINE display name is attacker-controlled: rendered as a text node only.
  const name = who.name || "ผู้ใช้ LINE";
  return (
    <AuthShell title="แพทย์ ยืนยันตัวตนทางอีเมล">
      <LineIdentity name={name} avatar={<ProfileAvatar src={avatarSrc(who.picture)} initial={initialOf(name)} size={28} />} />
      <div className="mt-6">
        <DoctorPanel names={names} back={pending ? "/login/verify" : "/login/claim"} />
      </div>
    </AuthShell>
  );
}
