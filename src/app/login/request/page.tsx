import { redirect } from "next/navigation";

/**
 * Access requests (a typed name, decided by an administrator) are gone: names come only from the staff list. An old
 * link or bookmark goes on to the name step (/login/claim), which sends a browser without its cookie back to /login.
 */
export default function RequestPage() {
  redirect("/login/claim");
}
