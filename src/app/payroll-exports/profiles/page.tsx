"use client";

import Link from "next/link";
import { ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

import { PayrollExportNav, PayrollStatus } from "@/components/payroll-export-nav";
import { Button, ConfirmDialog, EmptyState, PageHeader, Toast } from "@/components/ui";
import type { PayrollProfile } from "@/lib/payroll-ui-types";

const statusLabel = { archived: "アーカイブ", draft: "ドラフト", published: "公開済み" } as const;

async function responsePayload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

export default function PayrollProfilesPage() {
  const archiveButtonRef = useRef<HTMLButtonElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [profiles, setProfiles] = useState<PayrollProfile[]>([]);
  const [archiveTarget, setArchiveTarget] = useState<PayrollProfile>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const response = await fetch("/api/payroll-exports/profiles");
    const payload = (await response.json()) as { error?: string; profiles?: PayrollProfile[] };
    if (!response.ok) setError(payload.error ?? "プロファイルを取得できませんでした。");
    else {
      setProfiles(payload.profiles ?? []);
      setError(undefined);
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function duplicate(profile: PayrollProfile) {
    const name = window.prompt("複製後のプロファイル名", `${profile.name} のコピー`);
    if (!name) return;
    setSubmitting(true);
    const response = await fetch(`/api/payroll-exports/profiles/${profile.id}`, {
      body: JSON.stringify({ action: "duplicate", name }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const payload = await responsePayload(response);
    setSubmitting(false);
    if (!response.ok) setError(String(payload.error ?? "プロファイルを複製できませんでした。"));
    else {
      setSuccess("プロファイルをドラフトとして複製しました。");
      await load();
    }
  }

  async function archive() {
    if (!archiveTarget) return;
    setSubmitting(true);
    const response = await fetch(`/api/payroll-exports/profiles/${archiveTarget.id}`, {
      body: JSON.stringify({ action: "archive", expectedVersion: archiveTarget.version }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const payload = await responsePayload(response);
    setSubmitting(false);
    setArchiveTarget(undefined);
    if (!response.ok) setError(String(payload.error ?? "アーカイブできませんでした。"));
    else {
      setSuccess("プロファイルをアーカイブしました。過去の公開版とrunは保持されます。");
      await load();
    }
  }

  async function importSettings(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setSubmitting(true);
    try {
      const settings = JSON.parse(await file.text()) as unknown;
      const previewResponse = await fetch("/api/payroll-exports/profiles/import", {
        body: JSON.stringify({ mode: "preview", settings }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const preview = await responsePayload(previewResponse);
      if (!previewResponse.ok)
        throw new Error(String(preview.error ?? "設定を検査できませんでした。"));
      if (!window.confirm("検査に成功しました。新しいドラフトとして取り込みますか？")) return;
      const commitResponse = await fetch("/api/payroll-exports/profiles/import", {
        body: JSON.stringify({ mode: "commit", settings }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const commit = await responsePayload(commitResponse);
      if (!commitResponse.ok)
        throw new Error(String(commit.error ?? "設定を取り込めませんでした。"));
      setSuccess("設定JSONを新しいドラフトとして取り込みました。");
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "設定JSONを読み取れませんでした。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="payroll-page">
      <PageHeader title="給与連携プロファイル">
        給与ソフトへ渡す列、文字コード、変換規則を版として管理します。
      </PageHeader>
      <PayrollExportNav />
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>
      <div className="payroll-toolbar">
        <p>公開済みの版は変更されず、過去の出力を同じ条件で再現できます。</p>
        <div>
          <input
            accept="application/json,.json"
            className="sr-only"
            onChange={(event) => void importSettings(event)}
            ref={importRef}
            type="file"
          />
          <Button
            disabled={submitting}
            onClick={() => importRef.current?.click()}
            variant="secondary"
          >
            設定JSONを取り込む
          </Button>
        </div>
      </div>
      {!loaded ? (
        <EmptyState title="プロファイルを読み込んでいます">しばらくお待ちください。</EmptyState>
      ) : profiles.length === 0 ? (
        <EmptyState title="プロファイルがありません">
          migrationを適用すると汎用ドラフトが作成されます。
        </EmptyState>
      ) : (
        <section className="payroll-profile-list" aria-label="給与連携プロファイル一覧">
          {profiles.map((profile) => (
            <article key={profile.id}>
              <div className="payroll-profile-card__main">
                <div>
                  <PayrollStatus
                    tone={
                      profile.status === "published"
                        ? "success"
                        : profile.status === "archived"
                          ? "neutral"
                          : "warning"
                    }
                  >
                    {statusLabel[profile.status]}
                  </PayrollStatus>
                  <h2>{profile.name}</h2>
                  <p>{profile.description || "説明はありません。"}</p>
                </div>
                <dl>
                  <div>
                    <dt>列数</dt>
                    <dd>{profile.draftConfig.columns.length}</dd>
                  </div>
                  <div>
                    <dt>文字コード</dt>
                    <dd>{profile.draftConfig.encoding === "cp932" ? "CP932" : "UTF-8 BOM"}</dd>
                  </div>
                  <div>
                    <dt>更新</dt>
                    <dd>{new Date(profile.updatedAt).toLocaleDateString("ja-JP")}</dd>
                  </div>
                </dl>
              </div>
              <div className="payroll-card-actions">
                {profile.status !== "archived" ? (
                  <Link
                    className="ui-button ui-button--primary"
                    href={`/payroll-exports/profiles/${profile.id}`}
                  >
                    {profile.status === "draft" ? "編集する" : "版履歴を見る"}
                  </Link>
                ) : null}
                {profile.status !== "archived" ? (
                  <Link
                    className="ui-button ui-button--secondary"
                    href={`/payroll-exports/profiles/${profile.id}/mappings`}
                  >
                    従業員コード
                  </Link>
                ) : null}
                <a
                  className="ui-button ui-button--text"
                  download
                  href={`/api/payroll-exports/profiles/${profile.id}/settings`}
                >
                  設定を移出
                </a>
                {profile.status !== "archived" ? (
                  <Button
                    disabled={submitting}
                    onClick={() => void duplicate(profile)}
                    variant="text"
                  >
                    複製
                  </Button>
                ) : null}
                {profile.status === "draft" ? (
                  <Button
                    disabled={submitting}
                    onClick={() => setArchiveTarget(profile)}
                    ref={archiveButtonRef}
                    variant="danger"
                  >
                    アーカイブ
                  </Button>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      )}
      <ConfirmDialog
        confirmDisabled={submitting}
        confirmLabel="アーカイブする"
        onCancel={() => setArchiveTarget(undefined)}
        onConfirm={() => void archive()}
        open={Boolean(archiveTarget)}
        returnFocusRef={archiveButtonRef}
        title="プロファイルをアーカイブしますか？"
      >
        <p>一覧から使用できなくなります。公開版と過去の出力runは削除されません。</p>
      </ConfirmDialog>
    </main>
  );
}
