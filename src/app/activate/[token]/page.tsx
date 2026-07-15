"use client";

import type { FormEvent } from "react";
import { use, useState } from "react";

import { AuthShell } from "@/components/auth-shell";
import { Button, Field, Toast } from "@/components/ui";

export default function ActivatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);

    const password = new FormData(event.currentTarget).get("password");
    const response = await fetch("/api/activate", {
      body: JSON.stringify({ password, token }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    setSubmitting(false);

    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "パスワードを設定できませんでした。");
      return;
    }

    window.location.assign("/");
  }

  return (
    <AuthShell
      description="招待されたアカウントを有効にするため、ログイン用のパスワードを登録します。"
      eyebrow="ACCOUNT ACTIVATION"
      title="パスワードを設定"
    >
      <form className="auth-form" onSubmit={submit}>
        <Field
          autoComplete="new-password"
          autoFocus
          id="password"
          label="パスワード（12文字以上）"
          minLength={12}
          name="password"
          placeholder="12文字以上で入力"
          required
          type="password"
        />
        <Toast tone="error">{error}</Toast>
        <Button className="auth-submit" disabled={submitting} type="submit">
          {submitting ? "設定中…" : "設定してログイン"}
        </Button>
      </form>
      <p className="auth-help">
        安全のため、他のサービスで使用していないパスワードを設定してください。
      </p>
    </AuthShell>
  );
}
