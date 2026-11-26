import { notFound } from "next/navigation";
import { PlaceBar } from "@/components/place-bar";
import { PlacePicker } from "@/components/place-picker";

export const dynamic = "force-dynamic";

/** The choice of hospital without signing in, in development only, as an invented nurse sees it. */
export default function PreviewPlacesPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <PlaceBar eyebrow="ตารางห้องผ่าตัด" title="เลือกโรงพยาบาล" account={{ name: "ปราณี สายบุญ", role: "พยาบาล · ห้องผ่าตัด", phone: "081-234-5678", image: null }} />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <PlacePicker />
      </main>
    </div>
  );
}
