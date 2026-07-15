"use client";

import { Button } from "@/components/ui";

export function LogoutButton() {
  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  }

  return (
    <Button onClick={() => void logout()} type="button" variant="text">
      ログアウト
    </Button>
  );
}
