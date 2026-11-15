/**
 * The result of an action, said quietly inside the card or dialog that ran it (Pong, 15 Nov 2026: "the success /
 * failure status should subtly be within the components"): one short line of coloured text with a small icon, no box,
 * no tint, placed next to the button or on the row it concerns. The icon says success or failure, so the meaning does
 * not rest on colour alone.
 *
 * - success: green text and a tick. The caller clears it after a few seconds, as before.
 * - warning: red text and a warning triangle. It stays until the person edits or tries again.
 *
 * Keep `role` as it was on the box this replaces: "status" for a success (read politely), "alert" for a failure.
 * For a blocking state that is not the result of an action (a list that cannot be read), keep the Notice box.
 */
const ICON = {
  success: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.4l2.7 2.7L16 9.6" />
    </>
  ),
  warning: (
    <>
      <path d="M12 3.5l9 15.5H3z" />
      <path d="M12 10v4.2M12 17.2h.01" />
    </>
  ),
} as const;

export function InlineStatus({
  tone,
  role,
  className = "",
  children,
  id,
  testId,
}: {
  tone: keyof typeof ICON;
  /** For a field's aria-describedby. */
  id?: string;
  role?: "status" | "alert";
  className?: string;
  children: React.ReactNode;
  testId?: string;
}) {
  return (
    <p className={`inline-status inline-status-${tone} ${className}`} role={role} id={id} data-testid={testId}>
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {ICON[tone]}
      </svg>
      <span>{children}</span>
    </p>
  );
}
