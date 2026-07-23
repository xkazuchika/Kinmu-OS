"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { PayrollExportNav, PayrollStatus } from "@/components/payroll-export-nav";
import {
  Button,
  ConfirmDialog,
  EmptyState,
  Field,
  PageHeader,
  SelectField,
  TextareaField,
  Toast,
} from "@/components/ui";
import type { PayrollExportColumn, PayrollExportProfileConfig } from "@/lib/payroll-export-types";
import type { PayrollField, PayrollProfile, PayrollProfileVersion } from "@/lib/payroll-ui-types";

const defaultColumn = (index: number): PayrollExportColumn => ({
  formulaPolicy: "reject",
  header: `列${index + 1}`,
  id: `column_${Date.now()}_${index}`,
  required: false,
  source: { kind: "empty" },
  transform: { kind: "text" },
});

const transformLabels: Record<string, string> = {
  date: "日付",
  decimal_hours: "小数時間",
  hhmm: "HH:MM",
  integer: "整数",
  mapped_value: "区分対応",
  minutes: "整数分",
  text: "文字列",
  year_month: "年月",
};

export default function PayrollProfileEditorPage() {
  const { profileId } = useParams<{ profileId: string }>();
  const publishButtonRef = useRef<HTMLButtonElement>(null);
  const [profile, setProfile] = useState<PayrollProfile>();
  const [versions, setVersions] = useState<PayrollProfileVersion[]>([]);
  const [fields, setFields] = useState<PayrollField[]>([]);
  const [config, setConfig] = useState<PayrollExportProfileConfig>();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [publishOpen, setPublishOpen] = useState(false);
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    const [detailResponse, fieldsResponse] = await Promise.all([
      fetch(`/api/payroll-exports/profiles/${profileId}`),
      fetch("/api/payroll-exports/profiles"),
    ]);
    const detailPayload = (await detailResponse.json()) as {
      detail?: { profile: PayrollProfile; versions: PayrollProfileVersion[] };
      error?: string;
    };
    const fieldsPayload = (await fieldsResponse.json()) as { fields?: PayrollField[] };
    if (!detailResponse.ok || !detailPayload.detail) {
      setError(detailPayload.error ?? "プロファイルを取得できませんでした。");
      return;
    }
    setProfile(detailPayload.detail.profile);
    setVersions(detailPayload.detail.versions);
    setFields(fieldsPayload.fields ?? []);
    setConfig(structuredClone(detailPayload.detail.profile.draftConfig));
    setName(detailPayload.detail.profile.name);
    setDescription(detailPayload.detail.profile.description);
    setError(undefined);
  }, [profileId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function updateColumn(index: number, next: PayrollExportColumn) {
    setConfig((current) =>
      current
        ? {
            ...current,
            columns: current.columns.map((column, at) => (at === index ? next : column)),
          }
        : current,
    );
  }

  function moveColumn(index: number, direction: -1 | 1) {
    setConfig((current) => {
      if (!current) return current;
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= current.columns.length) return current;
      const columns = [...current.columns];
      [columns[index], columns[nextIndex]] = [columns[nextIndex], columns[index]];
      return { ...current, columns };
    });
  }

  async function action(body: Record<string, unknown>, fallback: string) {
    setSubmitting(true);
    const response = await fetch(`/api/payroll-exports/profiles/${profileId}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const payload = (await response.json()) as { error?: string };
    setSubmitting(false);
    if (!response.ok) {
      setError(
        response.status === 409
          ? "別の画面で更新されました。最新内容を再読み込みしました。変更を確認してもう一度操作してください。"
          : (payload.error ?? fallback),
      );
      if (response.status === 409) await load();
      return false;
    }
    await load();
    return true;
  }

  async function save() {
    if (!profile || !config) return;
    if (
      await action(
        { action: "save", config, description, expectedVersion: profile.version, name },
        "ドラフトを保存できませんでした。",
      )
    )
      setSuccess("設定を検査し、ドラフトを保存しました。");
  }

  async function publish() {
    if (!profile) return;
    setPublishOpen(false);
    if (
      await action(
        { action: "publish", expectedVersion: profile.version },
        "プロファイルを公開できませんでした。",
      )
    )
      setSuccess("プロファイルを不変の公開版として保存しました。");
  }

  async function newDraft() {
    if (!profile) return;
    if (
      await action(
        { action: "new_draft", expectedVersion: profile.version },
        "新しいドラフトを作成できませんでした。",
      )
    )
      setSuccess("最新の公開設定から新しいドラフトを作成しました。");
  }

  if (!profile || !config) {
    return (
      <main className="payroll-page">
        <PageHeader title="プロファイル編集" />
        <PayrollExportNav />
        <Toast tone="error">{error}</Toast>
        <EmptyState title="プロファイルを読み込んでいます">しばらくお待ちください。</EmptyState>
      </main>
    );
  }

  return (
    <main className="payroll-page payroll-editor-page">
      <div className="payroll-title-row">
        <PageHeader title={profile.name}>給与連携の列と変換規則を編集します。</PageHeader>
        <PayrollStatus tone={profile.status === "published" ? "success" : "warning"}>
          {profile.status === "published" ? "公開済み" : "ドラフト"}
        </PayrollStatus>
      </div>
      <PayrollExportNav />
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>

      {profile.status === "published" ? (
        <section className="payroll-published-banner">
          <div>
            <h2>公開版は変更できません</h2>
            <p>過去runを再現できるよう固定されています。変更は新しいドラフトから行います。</p>
          </div>
          <Button disabled={submitting} onClick={() => void newDraft()}>
            新しいドラフトを作成
          </Button>
        </section>
      ) : (
        <>
          <section className="feature-section" aria-labelledby="profile-basic-heading">
            <div>
              <h2 id="profile-basic-heading">基本設定</h2>
              <p>ファイルの形式と利用先が分かる名前を設定します。</p>
            </div>
            <div className="payroll-settings-grid">
              <Field
                id="profile-name"
                label="プロファイル名"
                onChange={(event) => setName(event.target.value)}
                value={name}
              />
              <Field
                id="profile-file-name"
                label="ファイル名"
                onChange={(event) => setConfig({ ...config, fileNamePattern: event.target.value })}
                value={config.fileNamePattern}
              />
              <SelectField
                id="profile-encoding"
                label="文字コード"
                onChange={(event) =>
                  setConfig({
                    ...config,
                    encoding: event.target.value as PayrollExportProfileConfig["encoding"],
                  })
                }
                value={config.encoding}
              >
                <option value="utf8_bom">UTF-8 BOM</option>
                <option value="cp932">CP932（Shift_JIS互換）</option>
              </SelectField>
              <SelectField
                id="profile-line-ending"
                label="改行コード"
                onChange={(event) =>
                  setConfig({
                    ...config,
                    lineEnding: event.target.value as PayrollExportProfileConfig["lineEnding"],
                  })
                }
                value={config.lineEnding}
              >
                <option value="crlf">CRLF（Windows）</option>
                <option value="lf">LF</option>
              </SelectField>
              <TextareaField
                id="profile-description"
                label="説明"
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                value={description}
              />
            </div>
          </section>

          <section className="feature-section" aria-labelledby="profile-columns-heading">
            <div className="payroll-section-heading">
              <div>
                <h2 id="profile-columns-heading">出力列</h2>
                <p>上から順にCSVへ出力します。任意式や列間参照は使用できません。</p>
              </div>
              <Button
                disabled={config.columns.length >= 60}
                onClick={() =>
                  setConfig({
                    ...config,
                    columns: [...config.columns, defaultColumn(config.columns.length)],
                  })
                }
                variant="secondary"
              >
                列を追加
              </Button>
            </div>
            <div className="payroll-column-list">
              {config.columns.map((column, index) => {
                const sourceField =
                  column.source.kind === "field" ? column.source.field : undefined;
                const selectedField = sourceField
                  ? fields.find((field) => field.key === sourceField)
                  : undefined;
                const transforms = selectedField?.compatibleTransforms ?? ["text", "mapped_value"];
                return (
                  <article className="payroll-column-card" key={column.id}>
                    <header>
                      <span aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                      <strong>{column.header}</strong>
                      <div
                        className="payroll-order-actions"
                        aria-label={`${column.header}の並べ替え`}
                      >
                        <Button
                          aria-label="一つ上へ移動"
                          disabled={index === 0}
                          onClick={() => moveColumn(index, -1)}
                          variant="text"
                        >
                          ↑
                        </Button>
                        <Button
                          aria-label="一つ下へ移動"
                          disabled={index === config.columns.length - 1}
                          onClick={() => moveColumn(index, 1)}
                          variant="text"
                        >
                          ↓
                        </Button>
                      </div>
                    </header>
                    <div className="payroll-column-fields">
                      <Field
                        id={`column-header-${index}`}
                        label="列名"
                        onChange={(event) =>
                          updateColumn(index, { ...column, header: event.target.value })
                        }
                        value={column.header}
                      />
                      <Field
                        id={`column-id-${index}`}
                        label="列ID"
                        onChange={(event) =>
                          updateColumn(index, { ...column, id: event.target.value })
                        }
                        value={column.id}
                      />
                      <SelectField
                        id={`column-source-kind-${index}`}
                        label="値の種類"
                        onChange={(event) => {
                          const kind = event.target.value;
                          updateColumn(index, {
                            ...column,
                            source:
                              kind === "field"
                                ? { kind: "field", field: fields[0]?.key ?? "employee_number" }
                                : kind === "fixed"
                                  ? { kind: "fixed", value: "" }
                                  : { kind: "empty" },
                            transform: { kind: "text" },
                          });
                        }}
                        value={column.source.kind}
                      >
                        <option value="field">勤怠・従業員項目</option>
                        <option value="fixed">固定値</option>
                        <option value="empty">空欄</option>
                      </SelectField>
                      {column.source.kind === "field" ? (
                        <SelectField
                          id={`column-field-${index}`}
                          label="参照項目"
                          onChange={(event) =>
                            updateColumn(index, {
                              ...column,
                              source: { kind: "field", field: event.target.value },
                              transform: { kind: "text" },
                            })
                          }
                          value={column.source.field}
                        >
                          {fields.map((field) => (
                            <option key={field.key} value={field.key}>
                              {field.label}
                            </option>
                          ))}
                        </SelectField>
                      ) : column.source.kind === "fixed" ? (
                        <Field
                          id={`column-fixed-${index}`}
                          label="固定値"
                          onChange={(event) =>
                            updateColumn(index, {
                              ...column,
                              source: { kind: "fixed", value: event.target.value },
                            })
                          }
                          value={column.source.value}
                        />
                      ) : null}
                      <SelectField
                        id={`column-transform-${index}`}
                        label="変換"
                        onChange={(event) =>
                          updateColumn(index, {
                            ...column,
                            transform:
                              event.target.value === "decimal_hours"
                                ? { kind: "decimal_hours", decimalPlaces: 2, rounding: "half_up" }
                                : event.target.value === "date"
                                  ? { kind: "date", dateFormat: "YYYY-MM-DD" }
                                  : event.target.value === "mapped_value"
                                    ? { kind: "mapped_value", valueMap: { sample: "sample" } }
                                    : {
                                        kind: event.target
                                          .value as PayrollExportColumn["transform"]["kind"],
                                      },
                          })
                        }
                        value={column.transform.kind}
                      >
                        {transforms.map((transform) => (
                          <option key={transform} value={transform}>
                            {transformLabels[transform] ?? transform}
                          </option>
                        ))}
                      </SelectField>
                      {column.transform.kind === "decimal_hours" ? (
                        <>
                          <Field
                            id={`column-decimals-${index}`}
                            label="小数桁"
                            max="6"
                            min="0"
                            onChange={(event) =>
                              updateColumn(index, {
                                ...column,
                                transform: {
                                  ...column.transform,
                                  decimalPlaces: Number(event.target.value),
                                },
                              })
                            }
                            type="number"
                            value={column.transform.decimalPlaces ?? 2}
                          />
                          <SelectField
                            id={`column-rounding-${index}`}
                            label="丸め方法"
                            onChange={(event) =>
                              updateColumn(index, {
                                ...column,
                                transform: {
                                  ...column.transform,
                                  rounding: event.target.value as "half_up" | "truncate",
                                },
                              })
                            }
                            value={column.transform.rounding ?? "half_up"}
                          >
                            <option value="half_up">四捨五入</option>
                            <option value="truncate">切り捨て</option>
                          </SelectField>
                        </>
                      ) : null}
                      {column.transform.kind === "date" ? (
                        <SelectField
                          id={`column-date-format-${index}`}
                          label="日付形式"
                          onChange={(event) =>
                            updateColumn(index, {
                              ...column,
                              transform: {
                                ...column.transform,
                                dateFormat: event.target.value as
                                  "YYYY-MM-DD" | "YYYY/MM/DD" | "YYYYMMDD",
                              },
                            })
                          }
                          value={column.transform.dateFormat ?? "YYYY-MM-DD"}
                        >
                          <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                          <option value="YYYY/MM/DD">YYYY/MM/DD</option>
                          <option value="YYYYMMDD">YYYYMMDD</option>
                        </SelectField>
                      ) : null}
                      {column.transform.kind === "mapped_value" ? (
                        <div className="payroll-value-map">
                          <span>区分対応</span>
                          {Object.entries(column.transform.valueMap ?? {}).map(
                            ([source, output], mapIndex) => (
                              <div key={`${source}-${mapIndex}`}>
                                <Field
                                  id={`column-map-source-${index}-${mapIndex}`}
                                  label="元の値"
                                  onChange={(event) => {
                                    const entries = Object.entries(column.transform.valueMap ?? {});
                                    entries[mapIndex] = [event.target.value, output];
                                    updateColumn(index, {
                                      ...column,
                                      transform: {
                                        ...column.transform,
                                        valueMap: Object.fromEntries(entries),
                                      },
                                    });
                                  }}
                                  value={source}
                                />
                                <Field
                                  id={`column-map-output-${index}-${mapIndex}`}
                                  label="出力値"
                                  onChange={(event) => {
                                    const entries = Object.entries(column.transform.valueMap ?? {});
                                    entries[mapIndex] = [source, event.target.value];
                                    updateColumn(index, {
                                      ...column,
                                      transform: {
                                        ...column.transform,
                                        valueMap: Object.fromEntries(entries),
                                      },
                                    });
                                  }}
                                  value={output}
                                />
                                <Button
                                  aria-label={`${source}の区分対応を削除`}
                                  disabled={
                                    Object.keys(column.transform.valueMap ?? {}).length <= 1
                                  }
                                  onClick={() => {
                                    const entries = Object.entries(
                                      column.transform.valueMap ?? {},
                                    ).filter((_, at) => at !== mapIndex);
                                    updateColumn(index, {
                                      ...column,
                                      transform: {
                                        ...column.transform,
                                        valueMap: Object.fromEntries(entries),
                                      },
                                    });
                                  }}
                                  variant="text"
                                >
                                  削除
                                </Button>
                              </div>
                            ),
                          )}
                          <Button
                            disabled={Object.keys(column.transform.valueMap ?? {}).length >= 100}
                            onClick={() => {
                              const nextKey = `value_${Object.keys(column.transform.valueMap ?? {}).length + 1}`;
                              updateColumn(index, {
                                ...column,
                                transform: {
                                  ...column.transform,
                                  valueMap: {
                                    ...(column.transform.valueMap ?? {}),
                                    [nextKey]: "",
                                  },
                                },
                              });
                            }}
                            variant="secondary"
                          >
                            対応値を追加
                          </Button>
                        </div>
                      ) : null}
                      <Field
                        id={`column-max-length-${index}`}
                        label="最大文字数（任意）"
                        max="10000"
                        min="1"
                        onChange={(event) =>
                          updateColumn(index, {
                            ...column,
                            maxLength: event.target.value ? Number(event.target.value) : undefined,
                          })
                        }
                        type="number"
                        value={column.maxLength ?? ""}
                      />
                      <SelectField
                        id={`column-formula-${index}`}
                        label="数式候補"
                        onChange={(event) =>
                          updateColumn(index, {
                            ...column,
                            formulaPolicy: event.target
                              .value as PayrollExportColumn["formulaPolicy"],
                          })
                        }
                        value={column.formulaPolicy}
                      >
                        <option value="reject">エラーにする</option>
                        <option value="prefix_apostrophe">警告して先頭に&apos;を付ける</option>
                      </SelectField>
                      <label className="feature-check payroll-required-check">
                        <input
                          checked={column.required}
                          onChange={(event) =>
                            updateColumn(index, { ...column, required: event.target.checked })
                          }
                          type="checkbox"
                        />
                        <span>
                          <strong>必須列</strong>
                          <small>空値を生成エラーにします。</small>
                        </span>
                      </label>
                    </div>
                    <Button
                      disabled={config.columns.length === 1}
                      onClick={() =>
                        setConfig({
                          ...config,
                          columns: config.columns.filter((_, at) => at !== index),
                        })
                      }
                      variant="danger"
                    >
                      列を削除
                    </Button>
                  </article>
                );
              })}
            </div>
          </section>
          <div className="payroll-sticky-actions">
            <span>{config.columns.length}列・未公開の変更</span>
            <Button disabled={submitting} onClick={() => void save()} variant="secondary">
              ドラフトを保存・検査
            </Button>
            <Button
              disabled={submitting}
              onClick={() => setPublishOpen(true)}
              ref={publishButtonRef}
            >
              公開前の確認
            </Button>
          </div>
        </>
      )}

      <section className="feature-section" aria-labelledby="profile-history-heading">
        <div>
          <h2 id="profile-history-heading">公開版履歴</h2>
          <p>公開時の列設定とハッシュを保持します。</p>
        </div>
        {versions.length ? (
          <div className="payroll-version-list">
            {versions.map((item) => (
              <div key={item.id}>
                <strong>v{item.version}</strong>
                <span>
                  {item.configSnapshot.columns.length}列・
                  {item.encoding === "cp932" ? "CP932" : "UTF-8 BOM"}
                </span>
                <time dateTime={item.publishedAt}>
                  {new Date(item.publishedAt).toLocaleString("ja-JP")}
                </time>
                <code>{item.configHash.slice(0, 12)}…</code>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="公開版はまだありません">
            ドラフトを保存し、内容を確認して公開してください。
          </EmptyState>
        )}
        <Link href={`/payroll-exports/profiles/${profile.id}/mappings`}>
          このプロファイルの外部従業員コードを設定
        </Link>
      </section>

      <ConfirmDialog
        confirmDisabled={submitting}
        confirmLabel="この設定を公開"
        onCancel={() => setPublishOpen(false)}
        onConfirm={() => void publish()}
        open={publishOpen}
        returnFocusRef={publishButtonRef}
        title="新しい公開版を作成しますか？"
      >
        <p>
          現在のドラフトを {config.columns.length}列・
          {config.encoding === "cp932" ? "CP932" : "UTF-8 BOM"} の不変な版として保存します。
        </p>
        <p>公開後に変更する場合は、別のドラフトと公開版が作成されます。</p>
      </ConfirmDialog>
    </main>
  );
}
