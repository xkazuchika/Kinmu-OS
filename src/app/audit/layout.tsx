import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/authenticated-shell";
export default function AuditLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
