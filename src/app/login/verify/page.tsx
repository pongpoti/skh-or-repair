import { redirect } from "next/navigation";
import { AuthShell, LineIdentity } from "@/components/auth-shell";
import { ProfileAvatar } from "@/components/profile-avatar";
import { getPendingLogin, getUser } from "@/lib/auth/server";
import { avatarSrc, initialOf } from "@/lib/avatar";
import { DOCTORS_ONLY } from "@/lib/claim-text";
import { phoneSignInOpen } from "@/lib/env";
import { isPhoneType, TYPE_LABELS, USER_TYPES } from "@/lib/user-labels";
import { AskAdmin, Chevron, H2, HELP } from "../shared";
import { VerifyForm } from "./verify-form";

export const dynamic = "force-dynamic";

/**
 * Step 1 after LINE: the position. Doctors (DR) prove who they are by an email code only (/login/doctor); everyone else
 * by an SMS code to their mobile number only (this page with ?as=RN|PN|PCA), then picks their own name from the staff
 * list (/login/claim). There is no other way in: no typed names, no access requests. While sign-in by number is closed
 * (the doctors-only pre-release, lib/env.ts phoneSignInOpen) the other positions stay on the list, greyed and inert,
 * with a line that says why.
 */
function PositionStep({ phoneOpen }: { phoneOpen: boolean }) {
  return (
    <div data-testid="verify-types">
      <h2 className={H2}>เลือกตำแหน่งของคุณ</h2>
      <p className={HELP}>
        ทำครั้งเดียว <span className="whitespace-nowrap">ครั้งต่อไปไม่ต้องยืนยันอีก</span>
      </p>
      <ul className="mt-4 grid gap-2">
        {USER_TYPES.map((t) => {
          const open = t === "DR" || phoneOpen;
          const text = (
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{TYPE_LABELS[t]}</span>
              <span className="block text-[0.8125rem] leading-5 text-muted">
                {t === "DR" ? "ยืนยันตัวตนด้วยรหัสทางอีเมล" : open ? "ยืนยันตัวตนด้วยรหัสทาง SMS" : "ยังไม่เปิดให้ใช้"}
              </span>
            </span>
          );
          return (
            <li key={t}>
              {open ? (
                <a className="choice" href={t === "DR" ? "/login/doctor" : `/login/verify?as=${t}`} data-testid={`verify-type-${t}`}>
                  {text}
                  <Chevron />
                </a>
              ) : (
                <button type="button" className="choice" disabled data-testid={`verify-type-${t}`}>
                  {text}
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {phoneOpen ? null : (
        <p className="mt-3 text-[0.8125rem] leading-5 font-semibold text-ink-2" data-testid="doctors-only">
          {DOCTORS_ONLY}
        </p>
      )}
      <AskAdmin className={phoneOpen ? "mt-4" : "mt-1"} />
    </div>
  );
}

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ as?: string | string[] }> }) {
  if (await getUser()) redirect("/");
  const pending = await getPendingLogin();
  if (!pending) redirect("/login");
  const as = (await searchParams).as;
  // Doctors never get the SMS form, whatever the address says.
  if (as === "DR") redirect("/login/doctor");
  const phoneOpen = phoneSignInOpen();
  // Nor does anyone while sign-in by number is closed: back to the position step.
  if (as !== undefined && !phoneOpen) redirect("/login/verify");
  const type = isPhoneType(as) ? as : null;
  // The LINE display name is attacker-controlled: rendered as a text node only.
  const name = pending.name || "ผู้ใช้ LINE";
  return (
    <AuthShell title={type ? "ยืนยันเบอร์มือถือ" : "ยืนยันตัวตน"}>
      <LineIdentity name={name} avatar={<ProfileAvatar src={avatarSrc(pending.picture)} initial={initialOf(name)} size={28} />} />
      <div className="mt-6">{type ? <VerifyForm type={type} /> : <PositionStep phoneOpen={phoneOpen} />}</div>
    </AuthShell>
  );
}
