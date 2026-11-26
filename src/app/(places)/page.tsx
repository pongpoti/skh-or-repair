import { redirect } from "next/navigation";
import { homeHref } from "@/lib/places";

export const dynamic = "force-dynamic";

/**
 * The app's address: รพ.สมุทรสาคร's board (Pong, 27 Nov 2026: "No more card selection. Default select is สมุทรสาคร").
 * Every sign-in and every opening of the app from LINE lands here and goes on to /skh, where the bar's switch reaches
 * รพ.ท่าฉลอม; an address of the board from before (`/?date=…`, `/?room=…`) keeps its query. Signed out, /skh asks for
 * the sign-in.
 */
export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(homeHref(await searchParams));
}
