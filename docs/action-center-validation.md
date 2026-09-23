# 要対応・日次通知の検証記録

実施日: 2026-09-23。変更: `add-attendance-action-center`。専用 PostgreSQL 16 と隔離 Compose、Next.js 16.3.3、Vitest 4.1.11、Chromium で確認した。本番データには接続していない。

| 仕様シナリオ                                                                               | 検証箇所                                                                                   | 結果 |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---- |
| 過去の未退勤・未解決、休暇・欠勤・休日・未有効・締め済みの除外、古い未締め月               | `action-items.test.ts`、`action-center.integration.test.ts`                                | 通過 |
| 期限同時刻、期限なし、差し戻し・再申請・取消、関連する複数日休暇                           | 同上、`ui-foundation.spec.ts`                                                              | 通過 |
| 本人・承認者・管理者の範囲、自己審査、再割当、無効担当・引継ぎ終了、他組織と不正な絞り込み | `action-center.integration.test.ts`、`action-items.test.ts`、役割別 E2E                    | 通過 |
| 50件ページング、安定順序、同じ集計のホームと一覧、戻り先の安全性                           | `action-center.integration.test.ts`、`navigation-context.test.ts`、`ui-foundation.spec.ts` | 通過 |
| 0件・絞り込み0件・読込・取得失敗、320pxとデスクトップ、キーボード操作                      | `ui-foundation.spec.ts`、`/tmp/kinmu-action-{desktop,mobile}.png`                          | 通過 |
| 9時境界・現地日付・夏時間・差し戻し翌日、新規対象、無効利用者、兼務、未割当・要再割当      | `action-items.test.ts`、`action-center.integration.test.ts`                                | 通過 |
| 並行実行、既読維持、組織別ロールバック、停止後の当日再開、通知から現在権限で開く           | `action-center.integration.test.ts`、隔離 Compose                                          | 通過 |
| v0.8からの移行・既存通知保持・再実行、参照先の組織境界                                     | `v08-migration.integration.test.ts`、専用DB移行                                            | 通過 |
| 初導入・正常更新・ビルド失敗・移行失敗、worker再起動、DB停止と復旧、空DBへの復元           | `operations-scripts.test.ts`、隔離 Compose                                                 | 通過 |

型チェック、Lint、整形、本番ビルド、単体・DB統合・移行の全227件、既存承認・締め・給与連携を含むE2E 16件は通過した。追加した役割別の画面確認と休暇・欠勤画面への対象日引継ぎは個別E2Eでも確認した。`pnpm audit --audit-level high` は既知の脆弱性0件。追加した修正版は Next.js 16.3.3、Vitest 4.1.11、間接依存の sharp 0.35.4・js-yaml 4.3.2。

性能は専用DBの100名・3か月・300ケースで、一覧106ms、ホーム集計111ms、worker82ms。2021年1月からの未締め期間（149,500件）は一覧約1.62秒。計測は単一組織・ローカル PostgreSQL 16、1回の実行で、ネットワーク越しや同時多数組織の負荷は含まない。

隔離 Compose は非root worker の起動・ヘルスを確認した。worker再起動2回と一回実行後も当日通知は4件で重複なし。DB停止時は一回実行とヘルスが失敗し、復旧後は成功した。更新前後と別の空DBへの復元後で、勤怠日8、打刻25、申請14、改訂15、月次期間3、月次改訂5、給与run1、通知46の各行数と内容ハッシュが一致した。バックアップ・復元は検証用データだけを使用した。

ブラウザ連携プラグインは初期化時に `Importing module "node:process" is not allowed in node_repl` で失敗した。承認済みのE2E手順に従い、Playwright Chromiumで画面・コンソール・応答・スクリーンショットを検証した。実機Safari・Firefox、長期間稼働するworker、遠隔DBと多数組織の同時負荷は未検証。Composeの旧式ビルダーは2GB VMで他サービスと同時に新規appビルドするとメモリ不足になったため、検証用appとworkerだけを一時停止してビルドした。更新スクリプトの通常更新はビルド済みイメージを用いて実測した。
