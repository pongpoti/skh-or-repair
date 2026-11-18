import { AuthShell, Notice } from "@/components/auth-shell";

const MESSAGES: Record<string, { title: string; body: string }> = {
  cancelled: { title: "ยกเลิกการเข้าสู่ระบบ", body: "ยังไม่ได้เข้าสู่ระบบ เริ่มใหม่ได้เลย" },
  state: {
    title: "ลิงก์เข้าสู่ระบบหมดอายุ",
    body: "ลิงก์นี้ใช้ไม่ได้แล้ว เริ่มเข้าสู่ระบบใหม่",
  },
  line: { title: "เชื่อมต่อ LINE ไม่สำเร็จ", body: "ลองใหม่อีกครั้ง" },
  config: { title: "ระบบยังไม่พร้อม", body: "ติดต่อผู้ดูแล" },
  failed: { title: "เกิดข้อผิดพลาด", body: "ลองใหม่อีกครั้ง" },
};

export default async function LoginErrorPage({ searchParams }: { searchParams: Promise<{ code?: string | string[] }> }) {
  const sp = await searchParams;
  const code = typeof sp.code === "string" && Object.hasOwn(MESSAGES, sp.code) ? sp.code : "failed";
  const msg = MESSAGES[code];
  return (
    <AuthShell title={msg.title}>
      <div data-testid="login-error" data-code={code}>
        <Notice tone="warning" role="alert">
          {msg.body}
        </Notice>
        {/* a full page load: /login goes straight on to LINE Login */}
        <a className="btn btn-primary mt-5 min-h-12 w-full" href="/login">
          ลองอีกครั้ง
        </a>
      </div>
    </AuthShell>
  );
}
