"use client";

import { FormEvent, use, useState } from "react";

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
    <main>
      <h1>パスワードを設定</h1>
      <form onSubmit={submit}>
        <label>
          パスワード（12文字以上）
          <input
            autoComplete="new-password"
            minLength={12}
            name="password"
            required
            type="password"
          />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={submitting} type="submit">
          {submitting ? "設定中…" : "設定してログイン"}
        </button>
      </form>
    </main>
  );
}
