import Link from "next/link";

import { PageHeader } from "@/components/ui";
import { loadEnvironment } from "@/lib/env";

export default function AboutPage() {
  const environment = loadEnvironment();
  return (
    <main className="profile-page">
      <PageHeader title="Kinmu-OSについて">実行中の配布物と対応ソースを確認できます。</PageHeader>
      <section className="about-guide-callout">
        <div>
          <h2>利用ガイド</h2>
          <p>役割に合う順で、初期設定から打刻、勤怠修正、レポートまで確認できます。</p>
        </div>
        <Link className="ui-button ui-button--primary" href="/guide">
          ガイドを開く
        </Link>
      </section>
      <dl className="profile-list">
        <div>
          <dt>バージョン</dt>
          <dd>{environment.appVersion}</dd>
        </div>
        <div>
          <dt>ライセンス</dt>
          <dd>GNU Affero General Public License v3.0 only</dd>
        </div>
        <div>
          <dt>対応ソース</dt>
          <dd>
            <a href={environment.sourceCodeUrl.toString()} rel="noreferrer" target="_blank">
              {environment.sourceCodeUrl.toString()}
            </a>
          </dd>
        </div>
      </dl>
      <p>
        このサーバーをネットワーク経由で利用できるようにした運営者は、改変を含む対応ソースを上記の場所から取得できる状態にしてください。
      </p>
    </main>
  );
}
