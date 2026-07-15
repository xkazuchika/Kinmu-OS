# Kinmu-OS

Kinmu-OSは、従業員100名以下の組織を対象にしたセルフホスト型の労務・勤怠管理ソフトです。v0.1は従業員台帳、部署、出退勤・休憩打刻、所定勤務ルール、実労働・残業集計、CSV、監査ログを扱います。

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

更新前にバックアップを取得し、リリースノートを確認します。

```sh
BACKUP_DIR=/secure/backups scripts/backup.sh
scripts/update.sh
```

`update.sh` は新しいイメージを作成し、使い捨てmigratorを成功させてからアプリだけを入れ替えます。失敗時はアプリを入れ替えず、ログを確認します。
各スクリプトは既定で `.env.production` を読みます。別の場所に置く場合は `ENV_FILE=/secure/kinmu.env` を指定します。

## バックアップと復元

`scripts/backup.sh` はUTC日時入りのPostgreSQLカスタム形式ファイルを作り、権限を600にします。別ホストまたは暗号化ストレージへ複製し、定期的に復元訓練を行ってください。

復元は空のデータベースだけを対象にします。

```sh
CONFIRM_RESTORE=EMPTY_DATABASE scripts/restore.sh backups/kinmu-YYYYMMDDTHHMMSSZ.dump
```

既存テーブルがある場合、復元スクリプトは停止します。復元後は `docker compose -f compose.production.yaml up -d app` を実行し、`/api/health`、ログイン、台帳、勤怠を確認します。

## トラブルシュート

- アプリが起動しない: `docker compose -f compose.production.yaml logs migrator app db` を確認します。
- ログインが保持されない: `APP_URL` が実際のHTTPS URLか、リバースプロキシがHTTPSを終端しているか確認します。
- DB接続エラー: `.env.production` のDB名・利用者・パスワードを揃えます。
- 対応ソースのリンクが違う: `SOURCE_CODE_URL` を稼働版と同じコミットまたは配布物へ更新します。

## 公開とライセンス

コードは [GNU AGPL-3.0-only](LICENSE) で配布します。ネットワーク経由で改変版を提供する場合、利用者が対応ソースを取得できるようにする必要があります。名称とロゴは [TRADEMARKS.md](TRADEMARKS.md) を参照してください。貢献、行動規範、脆弱性報告、リリース方針は各文書を参照してください。

v0.1の検証範囲、性能値、リリース時の確認事項は [リリース候補レビュー](docs/v0.1-release-candidate-review.md) に記録しています。
