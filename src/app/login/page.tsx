"use client";

import { FormEvent, useState } from "react";

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
    <main>
      <h1>ログイン</h1>
      <form onSubmit={submit}>
        <label>
          メールアドレス
          <input autoComplete="email" name="email" required type="email" />
        </label>
        <label>
          パスワード
          <input autoComplete="current-password" name="password" required type="password" />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button disabled={submitting} type="submit">
          {submitting ? "ログイン中…" : "ログイン"}
        </button>
      </form>
    </main>
  );
}
