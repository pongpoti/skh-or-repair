import { notFound } from "next/navigation";
import { PlaceBar } from "@/components/place-bar";
import { ThaChalomPlan } from "@/components/tha-chalom-plan";

export const dynamic = "force-dynamic";

/** รพ.ท่าฉลอม's page without signing in, in development only, as an invented nurse sees it. */
export default function PreviewThaChalomPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <PlaceBar
        eyebrow="แปลนห้องผ่าตัด ชั้น 5"
        title="รพ.ท่าฉลอม"
        back={{ href: "/preview/places", label: "เลือกโรงพยาบาล" }}
        account={{ name: "ปราณี สายบุญ", role: "พยาบาล · ห้องผ่าตัด", phone: "081-234-5678", image: null }}
      />
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6">
        <ThaChalomPlan className="h-full max-h-full w-full max-w-[64rem]" />
      </main>
    </div>
  );
}
