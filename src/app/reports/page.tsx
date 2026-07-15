"use client";

import { useState } from "react";
import { PageHeader } from "@/components/ui";

export default function ReportsPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  return (
    <main className="registry-page">
      <PageHeader title="レポート・CSV">
        業務確認用の勤怠と従業員台帳をUTF-8 CSVで出力します。
      </PageHeader>
      <p className="report-note">
        この集計は業務確認用であり、法令適合を自動判定するものではありません。
      </p>
      <section className="export-list">
        <article>
          <h2>勤怠CSV</h2>
          <label className="ui-field" htmlFor="export-month">
            <span>対象月</span>
            <input
              id="export-month"
              onChange={(event) => setMonth(event.target.value)}
              type="month"
              value={month}
            />
          </label>
          <a
            className="ui-button ui-button--primary"
            download
            href={`/api/exports/attendance?month=${month}`}
          >
            勤怠CSVを出力
          </a>
        </article>
        <article>
          <h2>従業員台帳CSV</h2>
          <p>現在の主所属と基本・雇用情報を出力します。</p>
          <a className="ui-button ui-button--secondary" download href="/api/exports/employees">
            従業員台帳CSVを出力
          </a>
        </article>
      </section>
    </main>
  );
}
