"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PayrollExportNav, PayrollStatus } from "@/components/payroll-export-nav";
import { Button, EmptyState, Field, PageHeader, Toast } from "@/components/ui";
import type { PayrollMapping, PayrollProfile } from "@/lib/payroll-ui-types";

type CsvPreview = {
  count: number;
  issues: Array<{ line: number; message: string }>;
  rows: unknown[];
};

export default function PayrollMappingsPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const fileRef = useRef<HTMLInputElement>(null);
  const [profile, setProfile] = useState<PayrollProfile>();
  const [mappings, setMappings] = useState<PayrollMapping[]>([]);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<"all" | "mapped" | "missing">("all");
  const [csv, setCsv] = useState<string>();
  const [csvPreview, setCsvPreview] = useState<CsvPreview>();
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [mappingResponse, profileResponse] = await Promise.all([
      fetch(`/api/payroll-exports/profiles/${profileId}/mappings`),
      fetch(`/api/payroll-exports/profiles/${profileId}`),
    ]);
    const mappingPayload = (await mappingResponse.json()) as {
      error?: string;
      mappings?: PayrollMapping[];
    };
    const profilePayload = (await profileResponse.json()) as {
      detail?: { profile: PayrollProfile };
    };
    if (!mappingResponse.ok)
      setError(mappingPayload.error ?? "外部従業員コードを取得できませんでした。");
    else {
      setMappings(mappingPayload.mappings ?? []);
      setProfile(profilePayload.detail?.profile);
      setError(undefined);
    }
  }, [profileId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("ja-JP");
    return mappings.filter((mapping) => {
      const mapped = Boolean(mapping.externalEmployeeCode);
      if (show === "mapped" && !mapped) return false;
      if (show === "missing" && mapped) return false;
      return (
        !query ||
        `${mapping.employeeNumber} ${mapping.displayName}`
          .toLocaleLowerCase("ja-JP")
          .includes(query)
      );
    });
  }, [mappings, search, show]);

  async function save(mapping: PayrollMapping, value: string) {
    setSubmitting(true);
    const response = await fetch(`/api/payroll-exports/profiles/${profileId}/mappings`, {
      body: JSON.stringify({
        employeeId: mapping.employeeId,
        expectedVersion: mapping.mappingVersion ?? 0,
        externalEmployeeCode: value.trim() || null,
      }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const payload = (await response.json()) as { error?: string };
    setSubmitting(false);
    if (!response.ok) {
      setError(
        response.status === 409
          ? "コード対応が更新されました。再読み込みして確認してください。"
          : (payload.error ?? "コードを保存できませんでした。"),
      );
      if (response.status === 409) await load();
      return;
    }
    setSuccess(`${mapping.displayName}の外部従業員コードを更新しました。`);
    await load();
  }

  async function previewCsv(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const content = await file.text();
    setSubmitting(true);
    const response = await fetch(`/api/payroll-exports/profiles/${profileId}/mappings/csv`, {
      body: JSON.stringify({ csv: content, mode: "preview" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string; preview?: CsvPreview };
    setSubmitting(false);
    if (!response.ok) {
      setError(payload.error ?? "CSVを検査できませんでした。");
      return;
    }
    setCsv(content);
    setCsvPreview(payload.preview);
    setSuccess(undefined);
  }

  async function commitCsv() {
    if (!csv || !csvPreview || csvPreview.issues.length) return;
    setSubmitting(true);
    const response = await fetch(`/api/payroll-exports/profiles/${profileId}/mappings/csv`, {
      body: JSON.stringify({ csv, mode: "commit" }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { count?: number; error?: string };
    setSubmitting(false);
    if (!response.ok) {
      setError(
        response.status === 409
          ? "検査後にコード対応が更新されました。CSVを再検査してください。"
          : (payload.error ?? "CSVを反映できませんでした。"),
      );
      return;
    }
    setCsv(undefined);
    setCsvPreview(undefined);
    setSuccess(`${payload.count ?? 0}件を原子的に反映しました。`);
    await load();
  }

  const missingCount = mappings.filter((mapping) => !mapping.externalEmployeeCode).length;

  return (
    <main className="payroll-page">
      <PageHeader title="外部従業員コード">
        {profile?.name ?? "プロファイル"}と給与ソフト側の従業員コードを対応付けます。
      </PageHeader>
      <PayrollExportNav />
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>
      <section className="payroll-mapping-overview">
        <div>
          <PayrollStatus tone={missingCount ? "warning" : "success"}>
            {missingCount ? `${missingCount}名が未設定` : "全員設定済み"}
          </PayrollStatus>
          <p>
            出力対象となる従業員は全員設定が必要です。コード値は監査一覧や通常ログへ表示しません。
          </p>
        </div>
        <div className="payroll-card-actions">
          <a
            className="ui-button ui-button--secondary"
            download
            href={`/api/payroll-exports/profiles/${profileId}/mappings/csv`}
          >
            CSVテンプレート
          </a>
          <input
            accept="text/csv,.csv"
            className="sr-only"
            onChange={(event) => void previewCsv(event)}
            ref={fileRef}
            type="file"
          />
          <Button disabled={submitting} onClick={() => fileRef.current?.click()}>
            CSVを全行検査
          </Button>
        </div>
      </section>
      {csvPreview ? (
        <section className="payroll-csv-preview" aria-labelledby="mapping-csv-preview-heading">
          <div>
            <h2 id="mapping-csv-preview-heading">CSV検査結果</h2>
            <p>
              {csvPreview.count}行を検査し、{csvPreview.issues.length}件の問題が見つかりました。
            </p>
          </div>
          {csvPreview.issues.length ? (
            <ul className="import-errors">
              {csvPreview.issues.map((issue, index) => (
                <li key={`${issue.line}-${index}`}>
                  {issue.line}行目: {issue.message}
                </li>
              ))}
            </ul>
          ) : (
            <PayrollStatus tone="success">全行を反映できます</PayrollStatus>
          )}
          <div className="payroll-card-actions">
            <Button
              onClick={() => {
                setCsv(undefined);
                setCsvPreview(undefined);
              }}
              variant="secondary"
            >
              取り消す
            </Button>
            <Button
              disabled={submitting || csvPreview.issues.length > 0}
              onClick={() => void commitCsv()}
            >
              全件を反映
            </Button>
          </div>
        </section>
      ) : null}
      <div className="payroll-mapping-filters">
        <Field
          id="mapping-search"
          label="従業員を検索"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="従業員番号・氏名"
          value={search}
        />
        <div role="group" aria-label="設定状態">
          {(["all", "missing", "mapped"] as const).map((value) => (
            <Button
              key={value}
              aria-pressed={show === value}
              onClick={() => setShow(value)}
              variant={show === value ? "primary" : "secondary"}
            >
              {value === "all" ? "すべて" : value === "missing" ? "未設定" : "設定済み"}
            </Button>
          ))}
        </div>
      </div>
      {filtered.length ? (
        <section className="payroll-mapping-list" aria-label="従業員コード対応一覧">
          {filtered.map((mapping) => (
            <form
              className="payroll-mapping-card"
              key={`${mapping.employeeId}:${mapping.mappingVersion ?? 0}`}
              onSubmit={(event) => {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                void save(mapping, String(data.get("externalEmployeeCode") ?? ""));
              }}
            >
              <div>
                <span>{mapping.employeeNumber}</span>
                <strong>{mapping.displayName}</strong>
                <small>{mapping.status === "active" ? "在籍" : "退職・無効"}</small>
              </div>
              <Field
                defaultValue={mapping.externalEmployeeCode ?? ""}
                id={`mapping-${mapping.employeeId}`}
                label="外部従業員コード"
                name="externalEmployeeCode"
              />
              <Button disabled={submitting} type="submit" variant="secondary">
                保存
              </Button>
            </form>
          ))}
        </section>
      ) : (
        <EmptyState title="該当する従業員はいません">検索条件を変更してください。</EmptyState>
      )}
      <Link href={`/payroll-exports/inspect?profileId=${profileId}`}>
        このプロファイルで全件検査へ進む
      </Link>
    </main>
  );
}
