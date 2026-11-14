"use client";

import { AdminBar } from "@/components/admin-bar";
import { Notice } from "@/components/auth-shell";

/**
 * When the upload page cannot load (the database or the holiday feed failed), a Thai message and a way to try again,
 * instead of the framework's English error page. The error itself is not shown: it is logged on the server.
 */
export default function UploadError({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <AdminBar title="อัปโหลดตารางผ่าตัด" />
      <main className="flex-1 overflow-y-auto overscroll-contain px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6 sm:pt-6">
        <div className="mx-auto w-full max-w-4xl">
          <section className="card space-y-4 p-4 sm:p-5" aria-labelledby="upload-error-title">
            <h2 id="upload-error-title" className="text-base font-bold text-ink sm:text-lg">
              โหลดหน้านี้ไม่สำเร็จ
            </h2>
            <Notice tone="warning" role="alert">
              ระบบขัดข้องชั่วคราว ลองอีกครั้ง
            </Notice>
            <button type="button" onClick={() => retry()} className="btn btn-primary">
              ลองอีกครั้ง
            </button>
          </section>
        </div>
      </main>
    </div>
  );
}
