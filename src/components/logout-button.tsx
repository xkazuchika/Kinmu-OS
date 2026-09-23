"use client";

import { Button } from "@/components/ui";

export function LogoutButton() {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    // Authentication changes must discard the previous session’s client/router cache.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.assign("/login");
  }

  return (
    <Button onClick={() => void logout()} type="button" variant="text">
      ログアウト
    </Button>
  );
}
