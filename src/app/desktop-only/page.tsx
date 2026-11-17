import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell, Notice } from "@/components/auth-shell";

export const metadata: Metadata = { title: "เปิดบนคอมพิวเตอร์ไม่ได้" };

/**
 * Shown (through the proxy's rewrite, lib/gate.ts needsDeskRole) to someone signed in on a computer or tablet who is
 * neither MX nor an admin (Pong, 17 Nov 2026: "only MX and admin is allowed to open desktop version"). The proxy has
 * already signed them out on this browser, so the next person at a shared computer starts from LINE's QR code.
 */
export default function DesktopOnlyPage() {
  return (
    <AuthShell title="เปิดบนคอมพิวเตอร์ไม่ได้" description="คอมพิวเตอร์ใช้ได้เฉพาะผู้จัดการตาราง (MX) และผู้ดูแลระบบ">
      <div data-testid="desktop-only">
        <Notice tone="info">เปิดจากเมนูใน LINE บนมือถือ</Notice>
        <Link className="btn btn-secondary mt-4 min-h-12 w-full" href="/" data-testid="desktop-only-reopen">
          เปิดตารางห้องผ่าตัดอีกครั้ง
        </Link>
      </div>
    </AuthShell>
  );
}
