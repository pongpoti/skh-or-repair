import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { AuthShell, Notice } from "@/components/auth-shell";
import { clientAllowed, gateMode, isPhone, liffUrl } from "@/lib/gate";

export const metadata: Metadata = { title: "เปิดผ่าน LINE บนมือถือ" };

/**
 * Shown (through the proxy's rewrite) to every browser the device gate turns away: a desktop, a tablet, a phone browser
 * outside LINE, or a LINE chat outside the LIFF app. It names the one way in, the LIFF link (once LIFF_ID is set).
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
    <AuthShell title="เปิดผ่าน LINE บนมือถือ" description="ตารางห้องผ่าตัดเปิดได้เฉพาะในแอป LINE บนโทรศัพท์มือถือเท่านั้น">
      <div data-testid="open-in-line" data-phone={phone ? "1" : "0"}>
        {phone ? (
          link ? (
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
          )
        ) : (
          <>
            <Notice tone="info">
              ไม่รองรับการเปิดบนคอมพิวเตอร์หรือแท็บเล็ต กรุณาเปิดจากแอป LINE บนโทรศัพท์มือถือ
            </Notice>
            {link ? (
              <p className="mt-4 text-center text-sm leading-6 text-muted">
                ลิงก์สำหรับเปิดใน LINE
                <br />
                <span className="font-medium break-all text-ink-2 select-all" data-testid="open-in-line-url">
                  {link}
                </span>
              </p>
            ) : null}
          </>
        )}
      </div>
    </AuthShell>
  );
}
