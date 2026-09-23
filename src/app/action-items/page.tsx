import { AuthenticatedShell } from "@/components/authenticated-shell";
import { ActionItemsPanel } from "@/components/action-items-panel";

export default function ActionItemsPage() {
  return (
    <AuthenticatedShell>
      <main className="registry-page feature-page">
        <ActionItemsPanel />
      </main>
    </AuthenticatedShell>
  );
}
