import { redirect } from "next/navigation";
import { AuthShell, LineIdentity } from "@/components/auth-shell";
import { ProfileAvatar } from "@/components/profile-avatar";
import { getPendingLogin, getUser } from "@/lib/auth/server";
import { avatarSrc, initialOf } from "@/lib/avatar";
import { VerifyForm } from "./verify-form";

/** Doctors prove who they are by a code sent to their email instead (/login/doctor). */
function DoctorWayIn() {
  return (
    <>
      <div className="mt-6 flex items-center gap-3 text-xs text-muted" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        หรือ
        <span className="h-px flex-1 bg-line" />
      </div>
      <a className="btn btn-outline mt-4 w-full" href="/login/doctor" data-testid="doctor-email-link">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3.5 6.5l8.5 6.5 8.5-6.5" />
        </svg>
        แพทย์ ยืนยันตัวตนทางอีเมล
      </a>
    </>
  );
}

export default async function VerifyPage() {
  if (await getUser()) redirect("/");
  const pending = await getPendingLogin();
  if (!pending) redirect("/login");
  // The LINE display name is attacker-controlled: rendered as a text node only.
  const name = pending.name || "ผู้ใช้ LINE";
  return (
    <AuthShell title="ยืนยันเบอร์มือถือ">
      <LineIdentity name={name} avatar={<ProfileAvatar src={avatarSrc(pending.picture)} initial={initialOf(name)} size={28} />} />
      <div className="mt-6">
        <VerifyForm other={<DoctorWayIn />} />
      </div>
    </AuthShell>
  );
}
