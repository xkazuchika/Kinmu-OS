import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";

import { PageHeader } from "@/components/ui";
import { sessionForToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getDatabase } from "@/lib/db/client";
import { guidesForRole, GUIDE_VERSION, roleLabel } from "@/lib/user-guide";

export default async function GuideIndexPage() {
  const cookieStore = await cookies();
  const actor = await sessionForToken(getDatabase(), cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!actor) redirect("/login");
  const guides = guidesForRole(actor.role);

  return (
    <main className="guide-index-page">
      <PageHeader title="利用ガイド">
        Kinmu-OS v{GUIDE_VERSION} の機能と操作を、あなたの役割に合う順で確認できます。
      </PageHeader>
      <section aria-labelledby="guide-scope-title" className="guide-intro">
        <div>
          <h2 id="guide-scope-title">勤怠と労務の日常業務を、ひとつずつ</h2>
          <p>初期設定から毎日の打刻、勤怠修正、CSV、監査まで、現在使える機能を案内します。</p>
        </div>
        <p className="guide-role-summary">
          ログイン中の役割: <strong>{roleLabel(actor.role)}</strong>
        </p>
      </section>
      <section aria-labelledby="guide-list-title" className="guide-list-section">
        <div className="guide-section-heading">
          <h2 id="guide-list-title">ガイド一覧</h2>
          <p>対象役割の記事を先に表示しています。すべての記事を閲覧できます。</p>
        </div>
        <ol className="guide-card-list">
          {guides.map((guide, index) => (
            <li key={guide.slug}>
              <Link className="guide-card" href={`/guide/${guide.slug}`}>
                <span aria-hidden="true" className="guide-card-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="guide-card-copy">
                  <strong>{guide.title}</strong>
                  <span>{guide.description}</span>
                  <span aria-label="対象役割" className="guide-role-list">
                    {guide.roles.map(roleLabel).join("・")}
                  </span>
                </span>
                <svg aria-hidden="true" className="guide-card-arrow" viewBox="0 0 24 24">
                  <path d="m9 5 7 7-7 7" />
                </svg>
              </Link>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
