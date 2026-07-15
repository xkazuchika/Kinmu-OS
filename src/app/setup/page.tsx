"use client";

import type { FormEvent } from "react";
import { useState } from "react";

import { AuthShell } from "@/components/auth-shell";
import { Button, Field, Toast } from "@/components/ui";

type SetupResult = { error?: string; setupUrl?: string };

export default function SetupPage() {
  const [error, setError] = useState<string>();
  const [setupUrl, setSetupUrl] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const response = await fetch("/api/setup", {
      body: JSON.stringify(Object.fromEntries(formData)),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const result = (await response.json()) as SetupResult;

    setSubmitting(false);

    if (!response.ok || !result.setupUrl) {
      setError(result.error ?? "初期設定を完了できませんでした。");
      return;
    }

    setSetupUrl(result.setupUrl);
  }

  return (
    <AuthShell
      description="最初の組織と、管理を始める所有者アカウントを登録します。"
      eyebrow="INITIAL SETUP"
      title="Kinmu-OSをセットアップ"
    >
      {setupUrl ? (
        <section aria-live="polite" className="auth-success">
          <span aria-hidden="true" className="auth-success__icon">
            ✓
          </span>
          <h2>準備ができました</h2>
          <p>初期設定リンクを発行しました。パスワードを設定して開始してください。</p>
          <a className="ui-button ui-button--primary auth-submit" href={setupUrl}>
            パスワードを設定する
          </a>
        </section>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <Field id="organizationName" label="組織名" name="organizationName" required />
          <Field
            defaultValue="Asia/Tokyo"
            id="timezone"
            label="タイムゾーン"
            name="timezone"
            required
          />
          <Field id="ownerName" label="所有者名" name="ownerName" required />
          <Field
            autoComplete="email"
            id="ownerEmail"
            label="所有者メールアドレス"
            name="ownerEmail"
            required
            type="email"
          />
          <Toast tone="error">{error}</Toast>
          <Button className="auth-submit" disabled={submitting} type="submit">
            {submitting ? "設定中…" : "初期設定を作成"}
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
