"use client";

import { FormEvent, useState } from "react";

import { useUnsavedChanges } from "@/components/form-state";
import { AsyncButton, Field, PageHeader, ResultSummary, Toast } from "@/components/ui";

type Profile = {
  contactEmail: string | null;
  departmentName: string;
  displayName: string;
  employeeNumber: string;
  employmentType: "contract" | "full_time" | "other" | "part_time";
  phoneNumber: string | null;
  status: "active" | "on_leave" | "scheduled" | "terminated";
};

const employmentLabels = {
  contract: "契約社員",
  full_time: "正社員",
  other: "その他",
  part_time: "パート・アルバイト",
};
const statusLabels = {
  active: "在籍",
  on_leave: "休職",
  scheduled: "予定入社",
  terminated: "退職",
};

export function ProfileEditor({ profile }: { profile: Profile }) {
  const [message, setMessage] = useState<{ text: string; tone: "error" | "success" }>();
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  useUnsavedChanges(dirty);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    const response = await fetch("/api/profile", {
      body: JSON.stringify(Object.fromEntries(new FormData(event.currentTarget))),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const payload = (await response.json()) as { error?: string };
    setSubmitting(false);

    setMessage(
      response.ok
        ? { text: "連絡先を更新しました。", tone: "success" }
        : { text: payload.error ?? "プロフィールを更新できませんでした。", tone: "error" },
    );
    if (response.ok) setDirty(false);
  }

  return (
    <main className="profile-page">
      <PageHeader status={statusLabels[profile.status]} title="プロフィール">
        自分の登録情報を確認し、連絡先だけを更新できます。
      </PageHeader>
      <dl className="profile-list">
        <div>
          <dt>氏名</dt>
          <dd>{profile.displayName}</dd>
        </div>
        <div>
          <dt>従業員番号</dt>
          <dd>{profile.employeeNumber}</dd>
        </div>
        <div>
          <dt>主所属</dt>
          <dd>{profile.departmentName}</dd>
        </div>
        <div>
          <dt>雇用区分</dt>
          <dd>{employmentLabels[profile.employmentType]}</dd>
        </div>
        <div>
          <dt>在籍状態</dt>
          <dd>{statusLabels[profile.status]}</dd>
        </div>
      </dl>
      <section className="profile-contact" aria-labelledby="profile-contact-heading">
        <h2 id="profile-contact-heading">連絡先</h2>
        <p>連絡先のみ自分で変更できます。雇用情報の変更は労務管理者へ依頼してください。</p>
        <form onChange={() => setDirty(true)} onSubmit={save}>
          <Field
            defaultValue={profile.contactEmail ?? ""}
            description="業務連絡に利用する任意のメールアドレスです。"
            fieldSize="long"
            id="profile-contact-email"
            label="連絡用メール"
            name="contactEmail"
            optional
            type="email"
          />
          <Field
            defaultValue={profile.phoneNumber ?? ""}
            example="090-1234-5678"
            id="profile-phone"
            label="電話番号"
            name="phoneNumber"
            optional
            type="tel"
          />
          <AsyncButton pending={submitting} pendingLabel="連絡先を保存しています" type="submit">
            連絡先を保存
          </AsyncButton>
        </form>
        {message?.tone === "success" ? (
          <ResultSummary title="連絡先を保存しました">{message.text}</ResultSummary>
        ) : (
          <Toast tone={message?.tone}>{message?.text}</Toast>
        )}
      </section>
    </main>
  );
}
