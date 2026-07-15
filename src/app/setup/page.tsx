"use client";

import { FormEvent, useState } from "react";

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
    <main>
      <h1>Kinmu-OS を始める</h1>
      {setupUrl ? (
        <section aria-live="polite">
          <p>初期設定リンクを発行しました。パスワードを設定して開始してください。</p>
          <a href={setupUrl}>{setupUrl}</a>
        </section>
      ) : (
        <form onSubmit={submit}>
          <label>
            組織名
            <input name="organizationName" required />
          </label>
          <label>
            タイムゾーン
            <input defaultValue="Asia/Tokyo" name="timezone" required />
          </label>
          <label>
            所有者名
            <input name="ownerName" required />
          </label>
          <label>
            所有者メールアドレス
            <input name="ownerEmail" required type="email" />
          </label>
          {error ? <p role="alert">{error}</p> : null}
          <button disabled={submitting} type="submit">
            {submitting ? "設定中…" : "初期設定を作成"}
          </button>
        </form>
      )}
    </main>
  );
}
