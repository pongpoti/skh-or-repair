"use client";

import { ErrorLanding } from "@/components/error-landing";
import "./globals.css";

/** When the root layout itself fails: the same as app/error.tsx, with its own <html> since the layout is gone. */
export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="th" className="h-full overflow-hidden antialiased">
      <body className="h-full overflow-hidden font-sans text-ink">
        <ErrorLanding error={error} />
      </body>
    </html>
  );
}
