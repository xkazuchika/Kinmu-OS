"use client";

import { ChangeEvent, useState } from "react";

import { Button, EmptyState, PageHeader, SelectField, Table, Toast } from "@/components/ui";

type ImportKind = "departments" | "employees";
type PreviewRow = Record<string, string | number | undefined>;
type ImportError = { line: number; message: string };

export default function CsvImportPage() {
  const [csv, setCsv] = useState("");
  const [errors, setErrors] = useState<ImportError[]>([]);
  const [kind, setKind] = useState<ImportKind>("departments");
  const [message, setMessage] = useState<string>();
  const [preview, setPreview] = useState<PreviewRow[]>([]);

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    setCsv(file ? await file.text() : "");
    setPreview([]);
    setErrors([]);
    setMessage(undefined);
  }

  async function submit(mode: "commit" | "preview") {
    const response = await fetch(`/api/imports/${kind}`, {
      body: JSON.stringify({ csv, mode }),
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    const payload = (await response.json()) as {
      count?: number;
      error?: string;
      errors?: ImportError[];
      preview?: PreviewRow[];
    };

    if (mode === "preview") {
      setPreview(payload.preview ?? []);
      setErrors(payload.errors ?? []);
      setMessage(
        payload.errors?.length
          ? "修正が必要な行があります。ファイル全体はまだ保存されていません。"
          : `${payload.preview?.length ?? 0}件を確認しました。内容を確認して取込を確定してください。`,
      );
      return;
    }
    if (!response.ok) {
      setErrors(payload.errors ?? []);
      setMessage(payload.error ?? "CSVを取り込めませんでした。");
      return;
    }
    setMessage(`${payload.count ?? 0}件を取り込みました。`);
    setCsv("");
    setPreview([]);
  }

  const columns =
    kind === "departments"
      ? ["code", "name"]
      : ["employeeNumber", "displayName", "departmentName", "joinedOn", "employmentType", "status"];

  return (
    <main className="registry-page">
      <PageHeader title="CSV取込">
        テンプレートを検証し、プレビュー後にファイル単位で反映します。
      </PageHeader>
      <section className="registry-create" aria-labelledby="csv-select-heading">
        <h2 id="csv-select-heading">ファイルを選択</h2>
        <SelectField
          id="csv-kind"
          label="取込対象"
          onChange={(event) => {
            setKind(event.target.value as ImportKind);
            setPreview([]);
            setErrors([]);
          }}
          value={kind}
        >
          <option value="departments">部署</option>
          <option value="employees">従業員台帳</option>
        </SelectField>
        <a download href={`/templates/${kind}.csv`}>
          テンプレートCSVをダウンロード
        </a>
        <label className="ui-field" htmlFor="csv-file">
          <span>CSVファイル（UTF-8）</span>
          <input accept=".csv,text/csv" id="csv-file" onChange={selectFile} type="file" />
        </label>
        <Button disabled={!csv} onClick={() => void submit("preview")} type="button">
          検証してプレビュー
        </Button>
      </section>
      <Toast tone={errors.length ? "error" : "success"}>{message}</Toast>
      {errors.length > 0 ? (
        <section aria-labelledby="csv-errors-heading">
          <h2 id="csv-errors-heading">修正が必要な内容</h2>
          <ul className="import-errors">
            {errors.map((error) => (
              <li key={`${error.line}-${error.message}`}>
                {error.line}行目: {error.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-labelledby="csv-preview-heading">
        <h2 id="csv-preview-heading">プレビュー</h2>
        {preview.length === 0 ? (
          <EmptyState title="プレビューはまだありません">
            CSVを選択して検証してください。
          </EmptyState>
        ) : (
          <>
            <Table label="CSV取込プレビュー">
              <thead>
                <tr>
                  <th>行</th>
                  {columns.map((column) => (
                    <th key={column}>{column}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={String(row.line)}>
                    <td>{row.line}</td>
                    {columns.map((column) => (
                      <td key={column}>{row[column] || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
            <Button
              disabled={errors.length > 0}
              onClick={() => void submit("commit")}
              type="button"
            >
              この内容で取込を確定
            </Button>
          </>
        )}
      </section>
    </main>
  );
}
