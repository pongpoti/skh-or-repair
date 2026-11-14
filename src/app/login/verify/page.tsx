import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth-shell";
import { ProfileAvatar } from "@/components/profile-avatar";
import { getPendingLogin, getUser } from "@/lib/auth/server";
import { avatarSrc, initialOf } from "@/lib/avatar";
import { VerifyForm } from "./verify-form";

export default async function VerifyPage() {
  if (await getUser()) redirect("/");
  const pending = await getPendingLogin();
  if (!pending) redirect("/login");
  // The LINE display name is attacker-controlled: rendered as a text node only.
  const name = pending.name || "ผู้ใช้ LINE";
  return (
    <AuthShell title="ยืนยันเบอร์มือถือ">
      <div className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
        <ProfileAvatar src={avatarSrc(pending.picture)} initial={initialOf(name)} size={40} />
        <p className="min-w-0 text-sm leading-6 text-ink-2" data-testid="line-name">
          เข้าสู่ระบบด้วย LINE ชื่อ <strong className="font-semibold break-words text-ink">{name}</strong>
        </p>
      </div>
      {/* Doctors prove who they are by a code sent to their email instead (/login/doctor). */}
      <a className="choice mt-4" href="/login/doctor" data-testid="doctor-email-link">
        <span className="min-w-0 flex-1">
          <span className="block font-semibold">แพทย์ ยืนยันตัวตนทางอีเมล</span>
          <span className="block text-[0.8125rem] leading-5 text-muted">ไม่ต้องใช้เบอร์มือถือ</span>
        </span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 text-muted">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </a>
      <div className="mt-5">
        <VerifyForm />
      </div>
    </AuthShell>
  );
}
