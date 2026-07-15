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
