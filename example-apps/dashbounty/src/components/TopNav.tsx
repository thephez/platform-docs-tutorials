import { shortId } from "../lib/format";
import type { SessionStatus } from "../session/SessionContext";

export type View =
  "submit" | "queue" | "my-submissions" | "panel" | "panels" | "account";

const TABS: { id: View; label: string }[] = [
  { id: "submit", label: "Submit" },
  { id: "queue", label: "Queue" },
  { id: "my-submissions", label: "My submissions" },
  { id: "panel", label: "Review panel" },
  { id: "panels", label: "Panels" },
  { id: "account", label: "Account" },
];

export function TopNav({
  view,
  onViewChange,
  status,
  identityId,
}: {
  view: View;
  onViewChange: (view: View) => void;
  status: SessionStatus;
  identityId: string | null;
}) {
  return (
    <div className="topbar">
      <h1>Sift</h1>
      <div className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={view === tab.id ? "active" : ""}
            onClick={() => onViewChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <span className="identity-pill">
        {status === "authenticated" && identityId
          ? shortId(identityId)
          : status === "connecting"
            ? "Connecting…"
            : "Read-only"}
      </span>
    </div>
  );
}
