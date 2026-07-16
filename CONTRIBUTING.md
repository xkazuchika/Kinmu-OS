# Contributing to Kinmu-OS

Issueで目的と再現手順を共有してから、小さなPull Requestとして提案してください。変更にはテスト、型検査、Lint、整形を含めます。投稿したコードはAGPL-3.0-onlyで配布されることに同意したものと扱います。

```sh
pnpm install
docker compose up -d db
pnpm db:migrate
pnpm test
pnpm typecheck
pnpm lint
```

## 利用ガイドの更新

機能、画面操作、利用できる役割を変更するPull Requestでは、`docs/user-guide/`の対応記事を同じ変更で更新してください。リリース前に次を確認します。

- 記事の「対象バージョン」と現行バージョンが一致している
- `src/lib/user-guide.ts`のカタログとMarkdownファイルが対応している
- 記事間の内部リンクが存在するslugを指している
- 現行機能と未対応機能の説明が実画面と一致している

アプリ内表示で対応するMarkdownは、1〜3段階の見出し、段落、箇条書き、番号付き手順、バッククォートのコード、同じディレクトリのMarkdownへの内部リンクです。生HTML、画像、表、引用、外部URLは使用しません。
