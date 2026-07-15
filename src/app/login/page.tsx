"use client";

import type { FormEvent } from "react";
import { useState } from "react";

import { AuthShell } from "@/components/auth-shell";
import { Button, Field, Toast } from "@/components/ui";

export default function LoginPage() {
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);

    const response = await fetch("/api/auth/login", {
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      headers: { "content-type": "application/json" },
      method: "POST",
    });

    setSubmitting(false);

    if (!response.ok) {
      const body = (await response.json()) as { error?: string };
      setError(body.error ?? "ログインできませんでした。");
      return;
    }

    window.location.assign("/");
  }

  return (
    <AuthShell
      description="組織のアカウントでログインしてください。"
      eyebrow="WELCOME BACK"
      title="おかえりなさい"
    >
      <form className="auth-form" onSubmit={submit}>
        <Field
          autoComplete="email"
          autoFocus
          id="email"
          label="メールアドレス"
          name="email"
          placeholder="name@company.jp"
          required
          type="email"
        />
        <Field
          autoComplete="current-password"
          id="password"
          label="パスワード"
          name="password"
          placeholder="パスワードを入力"
          required
          type="password"
        />
        <Toast tone="error">{error}</Toast>
        <Button className="auth-submit" disabled={submitting} type="submit">
          {submitting ? "ログイン中…" : "ログイン"}
        </Button>
      </form>
      <p className="auth-help">ログイン情報が不明な場合は、組織の管理者にお問い合わせください。</p>
    </AuthShell>
  );
}
