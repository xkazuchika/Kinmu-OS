import type { ReactNode } from "react";

import { AuthenticatedShell } from "@/components/authenticated-shell";

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
