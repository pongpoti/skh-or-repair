import { PlaceBar } from "@/components/place-bar";
import { ThaChalomPlan } from "@/components/tha-chalom-plan";
import { profileFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { formatPhone } from "@/lib/phone";
import { PLACES_PATH } from "@/lib/places";

export const dynamic = "force-dynamic";

/**
 * รพ.ท่าฉลอม (Pong, 26 Nov 2026: "When user select ท่าฉลอม. Just simply show layout. Do nothing for now"): its OR
 * suite's plan, floor 5, filling the screen under the bar, and the way back to the choice of hospital. No schedule, no
 * bookings, nothing to tap on the plan yet.
 */
export default async function ThaChalomPage() {
  const user = await requireUser();
  const profile = await profileFor(user, user.name);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <PlaceBar
        eyebrow="แปลนห้องผ่าตัด"
        title="รพ.ท่าฉลอม"
        back={{ href: PLACES_PATH, label: "เลือกโรงพยาบาล" }}
        account={{ name: profile.name, role: profile.role, phone: user.phone ? formatPhone(user.phone) : undefined, image: user.picture ?? null }}
      />
      <main className="flex min-h-0 flex-1 items-center justify-center overflow-hidden px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-6">
        <ThaChalomPlan className="h-full max-h-full w-full max-w-[64rem]" />
      </main>
    </div>
  );
}
