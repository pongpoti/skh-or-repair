import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { AuthShell, Notice } from "@/components/auth-shell";
import { clientAllowed, gateMode, isPhone, liffUrl } from "@/lib/gate";

export const metadata: Metadata = { title: "เปิดผ่าน LINE" };

/**
 * Shown (through the proxy's rewrite) to every browser the device gate turns away: a phone browser outside LINE, or a
 * LINE chat on a phone outside the LIFF app. It names the way in on the phone, the LIFF link (once LIFF_ID is set), and
 * that a computer opens the board too. Computers and tablets get in, so they see this page only by its own address.
 */
export default async function OpenInLinePage() {
  const ua = (await headers()).get("user-agent") ?? "";
  const mode = gateMode();
  const link = liffUrl();
  const phone = isPhone(ua);

  if (clientAllowed(ua, mode)) {
    return (
      <AuthShell title="ตารางห้องผ่าตัด">
        <Link className="btn btn-primary min-h-12 w-full" href="/" data-testid="gate-continue">
          เข้าสู่ตารางห้องผ่าตัด
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="เปิดผ่าน LINE" description="บนโทรศัพท์มือถือ ตารางห้องผ่าตัดเปิดได้ในแอป LINE">
      <div data-testid="open-in-line" data-phone={phone ? "1" : "0"}>
        {link ? (
          <>
            <a className="flex min-h-12 w-full items-center justify-center rounded-[10px] bg-[#05B14C] px-4 py-3 text-[1.0625rem] font-bold text-white no-underline hover:bg-[#049A42]" href={link} data-testid="open-in-line-link">
              เปิดใน LINE
            </a>
            <p className="mt-4 text-center text-sm leading-6 text-muted">
              ถ้าปุ่มไม่เปิดแอป ให้เปิดลิงก์ของระบบจากแชทหรือเมนูใน LINE
            </p>
          </>
        ) : (
          <Notice tone="info">เปิดลิงก์ของระบบจากแชทหรือเมนูในแอป LINE บนมือถือ</Notice>
        )}
        <p className="mt-4 text-center text-sm leading-6 text-muted">บนคอมพิวเตอร์เปิดได้จากเบราว์เซอร์ทั่วไป</p>
      </div>
    </AuthShell>
  );
}
