import type { ReactNode } from "react";

import { AuthenticatedShell } from "@/components/authenticated-shell";

export default function ProfileLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
