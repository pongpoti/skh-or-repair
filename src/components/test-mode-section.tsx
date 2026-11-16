import Link from "next/link";
import { AdminSection } from "@/components/admin-section";

/**
 * The admin page's test mode (Pong, 15 Nov 2026): the board with every kind of notice in its strip at once, seen by
 * admins only. Its link sits in the heading, greyed out and inert until the section is opened (Pong, 16 Nov 2026).
 * `href` is the board's address with ?notices=all (the development preview has its own).
 */
export function TestModeSection({ href }: { href: string }) {
  return (
    <AdminSection
      id="test-mode"
      title="โหมดทดสอบ"
      summary="แสดงการแจ้งเตือนทุกแบบพร้อมกันในแถบเหนือแผนผัง เห็นเฉพาะผู้ดูแลระบบ"
      actions={
        <Link href={href} className="btn btn-secondary" data-testid="test-notices-link">
          {/* On the narrowest phones "ทุกแบบ" would push the title onto two lines; the summary says it anyway. */}
          <span>
            ดูการแจ้งเตือน<span className="hidden min-[380px]:inline">ทุกแบบ</span>
          </span>
        </Link>
      }
      testId="test-mode-section"
    >
      {/* The kinds lib/board-notices.ts everyNotice() puts in the strip. */}
      <p className="p-4 text-sm text-ink-2 sm:p-5">การแจ้งเตือนที่จะเห็น: วันหยุด · โหลดเคสไม่สำเร็จ · ยังไม่มีตาราง HOSxP · ไม่ตรงกับการจอง ไม่บันทึกอะไร</p>
    </AdminSection>
  );
}
