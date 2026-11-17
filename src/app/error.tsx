"use client";

import { ErrorLanding } from "@/components/error-landing";

/** Any page that fails to render goes to the outage page (components/error-landing.tsx). */
export default function RootError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorLanding error={error} />;
}
