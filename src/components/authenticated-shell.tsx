import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { sessionForToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getDatabase } from "@/lib/db/client";

export async function AuthenticatedShell({ children }: { children: ReactNode }) {
  const cookieStore = await cookies();
  const actor = await sessionForToken(getDatabase(), cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!actor) {
    redirect("/login");
  }

  return (
    <AppShell actor={{ displayName: actor.displayName, role: actor.role }}>{children}</AppShell>
  );
}
