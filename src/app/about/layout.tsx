import type { ReactNode } from "react";
import { AuthenticatedShell } from "@/components/authenticated-shell";
export default function AboutLayout({ children }: { children: ReactNode }) {
  return <AuthenticatedShell>{children}</AuthenticatedShell>;
}
