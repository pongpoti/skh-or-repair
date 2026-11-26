import { redirect } from "next/navigation";
import { PlaceBar } from "@/components/place-bar";
import { PlacePicker } from "@/components/place-picker";
import { profileFor } from "@/lib/auth/display-name";
import { requireUser } from "@/lib/auth/server";
import { formatPhone } from "@/lib/phone";
import { movedBoardHref } from "@/lib/places";

export const dynamic = "force-dynamic";

/**
 * The app's first page (Pong, 26 Nov 2026: "When user sign in, display two place cards to allow user to first select
 * place"): every sign-in and every opening of the app from LINE lands here, and the card picks the hospital. An address
 * of the board from before (`/?date=…`, `/?room=…`) goes on to the board at /skh.
 */
export default async function PlacesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const moved = movedBoardHref(await searchParams);
  if (moved) redirect(moved);
  const profile = await profileFor(user, user.name);

  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <PlaceBar
        eyebrow="ตารางห้องผ่าตัด"
        title="เลือกโรงพยาบาล"
        account={{ name: profile.name, role: profile.role, phone: user.phone ? formatPhone(user.phone) : undefined, image: user.picture ?? null }}
      />
      <main className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <PlacePicker />
      </main>
    </div>
  );
}
