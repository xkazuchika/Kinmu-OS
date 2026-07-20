"use client";

import { useState } from "react";
import { PageHeader, SelectField } from "@/components/ui";

export default function ReportsPage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [requestStatus, setRequestStatus] = useState("");
  const [overtimeStatus, setOvertimeStatus] = useState("");
  const exportParameters = new URLSearchParams({ month });
  if (requestStatus) exportParameters.set("requestStatus", requestStatus);
  if (overtimeStatus) exportParameters.set("overtimeStatus", overtimeStatus);
  return (
    <main className="registry-page">
      <PageHeader title="レポート・CSV">
        業務確認用の勤怠と従業員台帳をUTF-8 CSVで出力します。
      </PageHeader>
      <p className="report-note">
        この集計は業務確認用であり、36協定・法定休日労働・割増賃金等の法令適合を自動判定しません。承認予定分数は実績へ加算されません。
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
          <SelectField
            id="export-request-status"
            label="残業申請の状態"
            onChange={(event) => setRequestStatus(event.target.value)}
            value={requestStatus}
          >
            <option value="">すべて</option>
            <option value="pending">審査待ち</option>
            <option value="approved">承認済み</option>
            <option value="rejected">却下</option>
            <option value="cancelled">取消済み</option>
          </SelectField>
          <SelectField
            id="export-overtime-status"
            label="実績差異"
            onChange={(event) => setOvertimeStatus(event.target.value)}
            value={overtimeStatus}
          >
            <option value="">すべて</option>
            <option value="within_request">申請内</option>
            <option value="under_request">申請未満</option>
            <option value="exceeded_request">申請超過</option>
            <option value="no_actual">実績なし</option>
            <option value="unapproved_actual">未申請の実績</option>
          </SelectField>
          <a
            className="ui-button ui-button--primary"
            download
            href={`/api/exports/attendance?${exportParameters}`}
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
        <article>
          <h2>休暇台帳CSV</h2>
          <p>付与・調整・消化・戻し・失効を追記順に出力します。</p>
          <a className="ui-button ui-button--secondary" download href="/api/exports/leave-ledger">
            休暇台帳CSVを出力
          </a>
        </article>
      </section>
    </main>
  );
}
