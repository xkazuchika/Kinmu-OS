"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PayrollExportNav, PayrollStatus } from "@/components/payroll-export-nav";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  SelectField,
  Toast,
} from "@/components/ui";
import type {
  PayrollInspection,
  PayrollProfile,
  PayrollProfileVersion,
} from "@/lib/payroll-ui-types";

const currentMonth = () => new Date().toISOString().slice(0, 7);

export default function PayrollInspectPage() {
  const generateButtonRef = useRef<HTMLButtonElement>(null);
  const [month, setMonth] = useState(currentMonth());
  const [profiles, setProfiles] = useState<PayrollProfile[]>([]);
  const [versions, setVersions] = useState<PayrollProfileVersion[]>([]);
  const [profileId, setProfileId] = useState("");
  const [profileVersionId, setProfileVersionId] = useState("");
  const [inspection, setInspection] = useState<PayrollInspection>();
  const [issueFilter, setIssueFilter] = useState<"all" | "error" | "warning">("all");
  const [generateOpen, setGenerateOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const loadVersions = useCallback(async (nextProfileId: string, requestedVersionId?: string) => {
    if (!nextProfileId) {
      setVersions([]);
      setProfileVersionId("");
      return;
    }
    const response = await fetch(`/api/payroll-exports/profiles/${nextProfileId}`);
    const payload = (await response.json()) as {
      detail?: { versions: PayrollProfileVersion[] };
      error?: string;
    };
    if (!response.ok) {
      setError(payload.error ?? "公開版を取得できませんでした。");
      return;
    }
    const nextVersions = payload.detail?.versions ?? [];
    setVersions(nextVersions);
    setProfileVersionId(
      nextVersions.some((version) => version.id === requestedVersionId)
        ? (requestedVersionId ?? "")
        : (nextVersions[0]?.id ?? ""),
    );
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(async () => {
      const parameters = new URLSearchParams(window.location.search);
      const requestedMonth = parameters.get("month") ?? currentMonth();
      const requestedProfileId = parameters.get("profileId") ?? "";
      const requestedVersionId = parameters.get("profileVersionId") ?? "";
      setMonth(requestedMonth);
      const response = await fetch("/api/payroll-exports/profiles");
      const payload = (await response.json()) as { error?: string; profiles?: PayrollProfile[] };
      if (!response.ok) {
        setError(payload.error ?? "プロファイルを取得できませんでした。");
        return;
      }
      const published = (payload.profiles ?? []).filter(
        (profile) => profile.status === "published",
      );
      setProfiles(published);
      const versionProfile = requestedVersionId
        ? (published.find((profile) => profile.id === requestedProfileId) ?? published[0])
        : (published.find((profile) => profile.id === requestedProfileId) ?? published[0]);
      setProfileId(versionProfile?.id ?? "");
      if (versionProfile) await loadVersions(versionProfile.id, requestedVersionId);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadVersions]);

  async function inspect(page = 1) {
    if (!profileVersionId) return;
    setSubmitting(true);
    setInspection(undefined);
    const response = await fetch("/api/payroll-exports/inspect", {
      body: JSON.stringify({ month, page, pageSize: 25, profileVersionId }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as { error?: string; inspection?: PayrollInspection };
    setSubmitting(false);
    if (!response.ok || !payload.inspection) {
      setError(payload.error ?? "全件検査を実行できませんでした。");
      return;
    }
    setInspection(payload.inspection);
    setError(undefined);
    setSuccess("対象者全員の検査が完了しました。");
  }

  async function generate() {
    if (!inspection) return;
    setGenerateOpen(false);
    setSubmitting(true);
    const confirmedWarningCodes = [
      ...new Set(
        inspection.issues
          .filter((issue) => issue.severity === "warning")
          .map((issue) => issue.code),
      ),
    ];
    const expectedMappingVersions = Object.fromEntries(
      inspection.mappings.map((mapping) => [mapping.employeeId, mapping.mappingVersion]),
    );
    const response = await fetch("/api/payroll-exports/runs", {
      body: JSON.stringify({
        allowOldRevision: !inspection.context.isLatestRevision,
        confirmedWarningCodes,
        expectedMappingVersions,
        expectedRevision: inspection.context.revision.revision,
        month,
        profileVersionId,
        revisionId: inspection.context.revision.id,
      }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    setSubmitting(false);
    if (!response.ok) {
      const payload = (await response.json()) as { error?: string };
      setError(
        response.status === 409
          ? "検査後に締め版・設定・コード対応が変わりました。もう一度全件検査してください。"
          : (payload.error ?? "CSVを生成できませんでした。"),
      );
      setInspection(undefined);
      return;
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `payroll-${month}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
    setSuccess(
      `CSVを生成しました。run ID: ${response.headers.get("X-Kinmu-Payroll-Run-Id") ?? "保存済み"}`,
    );
  }

  const filteredIssues = useMemo(
    () =>
      inspection?.issues.filter(
        (issue) => issueFilter === "all" || issue.severity === issueFilter,
      ) ?? [],
    [inspection, issueFilter],
  );
  const selectedVersion = versions.find((version) => version.id === profileVersionId);

  return (
    <main className="payroll-page">
      <PageHeader title="全件検査・CSV生成">
        対象となる全従業員を検査し、条件が変わっていないことを再確認して生成します。
      </PageHeader>
      <PayrollExportNav />
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>
      <form
        className="payroll-inspect-form"
        onSubmit={(event) => {
          event.preventDefault();
          void inspect();
        }}
      >
        <Field
          id="inspect-month"
          label="対象月"
          onChange={(event) => {
            setMonth(event.target.value);
            setInspection(undefined);
          }}
          type="month"
          value={month}
        />
        <SelectField
          id="inspect-profile"
          label="プロファイル"
          onChange={(event) => {
            setProfileId(event.target.value);
            setInspection(undefined);
            void loadVersions(event.target.value);
          }}
          value={profileId}
        >
          {profiles.length === 0 ? <option value="">公開済みプロファイルなし</option> : null}
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.name}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="inspect-version"
          label="公開版"
          onChange={(event) => {
            setProfileVersionId(event.target.value);
            setInspection(undefined);
          }}
          value={profileVersionId}
        >
          {versions.map((version) => (
            <option key={version.id} value={version.id}>
              v{version.version}・{version.configSnapshot.columns.length}列
            </option>
          ))}
        </SelectField>
        <Button disabled={submitting || !profileVersionId} type="submit">
          全件検査を実行
        </Button>
      </form>

      {!profiles.length ? (
        <EmptyState
          action={<Link href="/payroll-exports/profiles">プロファイルを設定</Link>}
          title="公開済みプロファイルがありません"
        >
          ドラフトの列設定を検査して公開してください。
        </EmptyState>
      ) : null}

      {inspection ? (
        <>
          <section
            className="payroll-validation-summary"
            aria-labelledby="validation-summary-heading"
          >
            <div>
              <p className="payroll-eyebrow">VALIDATION RESULT</p>
              <h2 id="validation-summary-heading">
                {inspection.summary.errorCount === 0 ? "CSVを生成できます" : "修正が必要です"}
              </h2>
              <span>
                {inspection.totalRows}名・リビジョン {inspection.context.revision.revision}・公開版
                v{inspection.context.profileVersion.version}
              </span>
            </div>
            <dl>
              <div>
                <dt>対象者</dt>
                <dd>{inspection.totalRows}名</dd>
              </div>
              <div>
                <dt>エラー</dt>
                <dd>{inspection.summary.errorCount}件</dd>
              </div>
              <div>
                <dt>警告</dt>
                <dd>{inspection.summary.warningCount}件</dd>
              </div>
              <div>
                <dt>列</dt>
                <dd>{selectedVersion?.configSnapshot.columns.length ?? 0}列</dd>
              </div>
            </dl>
            <Button
              disabled={submitting || inspection.summary.errorCount > 0}
              onClick={() => setGenerateOpen(true)}
              ref={generateButtonRef}
            >
              生成内容を確認
            </Button>
          </section>

          {inspection.issues.length ? (
            <section className="payroll-issues" aria-labelledby="payroll-issues-heading">
              <div className="payroll-section-heading">
                <div>
                  <h2 id="payroll-issues-heading">検査結果</h2>
                  <p>従業員・列・解消方法を確認してください。</p>
                </div>
                <div role="group" aria-label="問題の種類">
                  {(["all", "error", "warning"] as const).map((value) => (
                    <Button
                      aria-pressed={issueFilter === value}
                      key={value}
                      onClick={() => setIssueFilter(value)}
                      variant={issueFilter === value ? "primary" : "secondary"}
                    >
                      {value === "all" ? "すべて" : value === "error" ? "エラー" : "警告"}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="payroll-issue-list">
                {filteredIssues.map((issue, index) => (
                  <article
                    key={`${issue.code}-${issue.employeeId ?? "all"}-${issue.columnId ?? "all"}-${index}`}
                  >
                    <PayrollStatus tone={issue.severity === "error" ? "danger" : "warning"}>
                      {issue.severity === "error" ? "エラー" : "警告"}
                    </PayrollStatus>
                    <div>
                      <strong>{issue.message}</strong>
                      <span>
                        {issue.employeeId ? `従業員 ${issue.employeeId.slice(0, 8)}…` : "出力全体"}
                        {issue.columnId ? `・列 ${issue.columnId}` : ""}
                      </span>
                    </div>
                    {issue.code === "mapping_missing" ? (
                      <Link
                        href={`/payroll-exports/profiles/${inspection.context.profileVersion.profileId}/mappings`}
                      >
                        コードを設定
                      </Link>
                    ) : (
                      <span>プロファイルまたは締め内容を確認</span>
                    )}
                  </article>
                ))}
              </div>
            </section>
          ) : null}

          <section className="payroll-preview" aria-labelledby="payroll-preview-heading">
            <div>
              <h2 id="payroll-preview-heading">変換プレビュー</h2>
              <p>変換前後の値をページ単位で確認します。値はこの画面だけに表示されます。</p>
            </div>
            <div className="payroll-preview-list">
              {inspection.previewRows.map((row) => (
                <article key={row.employeeId}>
                  <header>
                    <strong>{row.displayName ?? row.externalEmployeeCode}</strong>
                    <span>{row.externalEmployeeCode}</span>
                  </header>
                  <dl>
                    {row.cells.slice(0, 8).map((cell) => (
                      <div key={cell.columnId}>
                        <dt>{cell.columnId}</dt>
                        <dd>
                          <small>
                            {cell.sourceValue === null ? "空値" : String(cell.sourceValue)}
                          </small>
                          <span aria-hidden="true">→</span>
                          <strong>{cell.value || "（空欄）"}</strong>
                        </dd>
                      </div>
                    ))}
                  </dl>
                </article>
              ))}
            </div>
            {inspection.pageCount > 1 ? (
              <div className="payroll-pagination">
                <Button
                  disabled={submitting || inspection.page === 1}
                  onClick={() => void inspect(inspection.page - 1)}
                  variant="secondary"
                >
                  前へ
                </Button>
                <span>
                  {inspection.page} / {inspection.pageCount}ページ
                </span>
                <Button
                  disabled={submitting || inspection.page === inspection.pageCount}
                  onClick={() => void inspect(inspection.page + 1)}
                  variant="secondary"
                >
                  次へ
                </Button>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      <ConfirmDialog
        confirmDisabled={submitting || Boolean(inspection?.summary.errorCount)}
        confirmLabel="確認してCSVを生成"
        onCancel={() => setGenerateOpen(false)}
        onConfirm={() => void generate()}
        open={generateOpen}
        returnFocusRef={generateButtonRef}
        title="この条件で給与連携CSVを生成しますか？"
      >
        <dl className="payroll-confirm-details">
          <div>
            <dt>対象月</dt>
            <dd>{month}</dd>
          </div>
          <div>
            <dt>締めリビジョン</dt>
            <dd>{inspection?.context.revision.revision}</dd>
          </div>
          <div>
            <dt>プロファイル版</dt>
            <dd>v{inspection?.context.profileVersion.version}</dd>
          </div>
          <div>
            <dt>件数・列数</dt>
            <dd>
              {inspection?.totalRows}名・{selectedVersion?.configSnapshot.columns.length}列
            </dd>
          </div>
          <div>
            <dt>文字コード</dt>
            <dd>{selectedVersion?.encoding === "cp932" ? "CP932" : "UTF-8 BOM"}</dd>
          </div>
          <div>
            <dt>警告</dt>
            <dd>{inspection?.summary.warningCount ?? 0}件を確認</dd>
          </div>
        </dl>
        <p>小数時間の列はプロファイルで指定した桁数と丸め方法を使用します。</p>
        <p>
          <strong>このCSVは給与計算結果ではありません。</strong>{" "}
          利用先で件数と時間合計を照合してください。
        </p>
      </ConfirmDialog>
    </main>
  );
}
