# Kinmu-OS

Kinmu-OSは、従業員100名以下の組織を対象にしたセルフホスト型の労務・勤怠管理ソフトです。v0.3は従業員台帳、部署、出退勤・休憩打刻、勤怠修正申請、所定勤務ルール、実労働・残業集計、月次勤怠の締め・再開、確定CSV、監査ログを扱います。

## 利用ガイドと現行機能

現行バージョンは、所有者・労務管理者向けの初期設定、利用者・部署・従業員・勤務ルール管理、勤怠修正審査、月次締め、CSV、監査ログと、従業員向けの打刻、勤務実績、修正申請、プロフィールを提供します。

リポジトリでは [利用ガイドの目次](docs/user-guide/overview.md) から役割別の手順を確認できます。稼働中のアプリでは、ログイン後に「このソフト」から「利用ガイド」を開いてください。ガイドの対象バージョンは0.3.0です。

## 勤怠修正申請

従業員は自分の勤務実績から出勤・退勤・休憩の追加、時刻変更、削除を理由付きで申請できます。所有者または労務管理者が承認すると、有効な打刻、実労働、残業、勤怠CSVへ同じ再計算結果が反映されます。申請、取消、承認、却下、反映は監査ログへ記録されます。

申請中に通常打刻が更新された場合、承認は競合として停止します。管理者は承認せず、従業員に最新の勤務実績から取り消し・再申請してもらってください。詳しい運用は [勤怠修正申請の運用](docs/attendance-corrections.md) を参照してください。

## 月次勤怠の締め

終了した月は「勤怠」で未退勤、審査待ち申請、集計未作成が0件であることを確認してから締めます。締めると従業員・部署・勤務ルール・日次集計がリビジョン付きスナップショットとして確定し、通常打刻と修正操作を停止します。給与連携前には一覧と残業集計を確認し、締め状態・日時・リビジョン入りの勤怠CSVを安全な保管先へ保存してください。

締め後に修正が必要な場合は、経緯が分かる理由を入力して再開します。修正と審査後に再度締め、新しいリビジョンのCSVを保管して利用先へ変更を伝えます。締め・再開・再締めは監査ログへ記録され、過去リビジョンも保持されます。詳しい操作は [月次勤怠の締め・再開](docs/user-guide/monthly-closing.md) を参照してください。

## ローカル開発

Node.js 22、pnpm 11、Docker/Colimaが必要です。
Compose v2の `docker compose` と互換性のある `docker-compose` のどちらでも運用スクリプトを利用できます。

```sh
pnpm install
docker compose up -d db
pnpm db:migrate
pnpm dev
```

`http://localhost:3000/setup` で最初の組織と所有者を作成します。品質チェックは `pnpm typecheck && pnpm lint && pnpm test && pnpm build`、実画面テストはアプリ起動後に `pnpm test:e2e` です。

## 本番導入

1. `.env.production.example` を `.env.production` へコピーし、強い `POSTGRES_PASSWORD` と32文字以上の `SESSION_SECRET` を設定します。
2. `APP_URL` は利用者がアクセスするHTTPS URL、`SOURCE_CODE_URL` はこの稼働版に対応する公開ソースのURLにします。
3. `docker compose --env-file .env.production -f compose.production.yaml up -d --build` を実行します。マイグレーションが失敗するとアプリは起動しません。
4. `http://127.0.0.1:3100` をCaddy、nginx、TraefikなどのTLSリバースプロキシの背後で公開します。アプリのポートをインターネットへ直接公開しないでください。
5. `/setup` で初期設定を一度だけ完了します。

シークレットをGitへ保存しないでください。Cookieの `Secure` 属性は `APP_URL=https://...` の場合に有効になります。

## 更新

更新前にバックアップを取得し、リリースノートを確認します。給与連携の締め処理中や再開後の修正途中では更新を避け、再締めと確定CSVの保管を終えてから実施してください。

```sh
BACKUP_DIR=/secure/backups scripts/backup.sh
scripts/update.sh
```

`update.sh` は新しいイメージを作成し、使い捨てmigratorを成功させてからアプリだけを入れ替えます。失敗時はアプリを入れ替えず、ログを確認します。
各スクリプトは既定で `.env.production` を読みます。別の場所に置く場合は `ENV_FILE=/secure/kinmu.env` を指定します。

## バックアップと復元

`scripts/backup.sh` はUTC日時入りのPostgreSQLカスタム形式ファイルを作り、権限を600にします。月次締めの前後と更新前に取得し、確定CSVとともに別ホストまたは暗号化ストレージへ複製して、定期的に復元訓練を行ってください。

復元は空のデータベースだけを対象にします。

```sh
CONFIRM_RESTORE=EMPTY_DATABASE scripts/restore.sh backups/kinmu-YYYYMMDDTHHMMSSZ.dump
```

既存テーブルがある場合、復元スクリプトは停止します。復元後は `docker compose -f compose.production.yaml up -d app` を実行し、`/api/health`、ログイン、台帳、勤怠に加え、直近の締め状態・リビジョンと保管済みCSVが一致することを確認します。

## トラブルシュート

- アプリが起動しない: `docker compose -f compose.production.yaml logs migrator app db` を確認します。
- ログインが保持されない: `APP_URL` が実際のHTTPS URLか、リバースプロキシがHTTPSを終端しているか確認します。
- DB接続エラー: `.env.production` のDB名・利用者・パスワードを揃えます。
- 対応ソースのリンクが違う: `SOURCE_CODE_URL` を稼働版と同じコミットまたは配布物へ更新します。

## 公開とライセンス

コードは [GNU AGPL-3.0-only](LICENSE) で配布します。ネットワーク経由で改変版を提供する場合、利用者が対応ソースを取得できるようにする必要があります。名称とロゴは [TRADEMARKS.md](TRADEMARKS.md) を参照してください。貢献、行動規範、脆弱性報告、リリース方針は各文書を参照してください。

初期リリースの検証範囲、性能値、リリース時の確認事項は [リリース候補レビュー](docs/v0.1-release-candidate-review.md) に記録しています。
