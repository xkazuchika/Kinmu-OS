# v0.7 screen catalog

## Role entry points

### Owner and HR administrator

1. ホームで初期設定または対象月の未完了業務を確認する
2. 対応が必要な件数から絞り込み済み一覧へ移動する
3. 詳細・審査・修正を完了して元の対象月へ戻る
4. 阻害要因がなくなったら月次勤怠を締める
5. 給与連携を利用する組織だけ、検査・CSV生成へ進む

### Employee

1. ホームで現在の打刻状態と申請状況を確認する
2. 打刻、勤務実績、勤怠修正、休暇、残業・休日出勤へ進む
3. 提出後の状態と取消可能な場所を確認する
4. 通知またはホームから必要な結果へ戻る

## Major screens

| Area         | Route                     | Roles     | Purpose                      | Completion / next              |
| ------------ | ------------------------- | --------- | ---------------------------- | ------------------------------ |
| ホーム       | `/`                       | all       | 現在の状態と次の業務を確認   | 未完了業務または日常操作へ進む |
| 初期設定     | `/setup`                  | owner, HR | 組織と最初の管理者を準備     | 従業員・勤務設定へ進む         |
| 従業員       | `/employees`              | owner, HR | 台帳と所属を管理             | 詳細、取込、勤務設定へ進む     |
| 部署         | `/employees/departments`  | owner, HR | 主所属の選択肢を管理         | 従業員へ割り当てる             |
| 従業員CSV    | `/employees/import`       | owner, HR | 台帳を一括検査・反映         | 結果を確認して一覧へ戻る       |
| 勤怠状況     | `/attendance`             | owner, HR | 未退勤・未解決を確認         | 問題解消後に月次締めへ進む     |
| 勤務ルール   | `/attendance/rules`       | owner, HR | 所定時間と休憩を設定         | 適用開始日と影響を確認する     |
| 勤務実績     | `/attendance/me`          | employee  | 自分の日次・月次実績を確認   | 必要なら修正申請へ進む         |
| 勤怠修正     | `/attendance/corrections` | all       | 打刻変更を申請・審査         | 結果または元の対象月へ戻る     |
| カレンダー   | `/calendar`               | owner, HR | 勤務日区分と例外を設定       | 有効化して勤務予定を確認する   |
| 休暇申請     | `/leave`                  | employee  | 残高を確認して申請           | 審査待ち状態を確認する         |
| 休暇管理     | `/leave/manage`           | owner, HR | 種別、付与、残高を管理       | 台帳または審査へ進む           |
| 休暇審査     | `/leave/reviews`          | owner, HR | 残高と競合を確認して審査     | 一覧または月次へ戻る           |
| 残業申請     | `/overtime`               | employee  | 予定時間を申請               | 審査結果と実績差異を確認する   |
| 残業審査     | `/overtime/reviews`       | owner, HR | 予定と勤務予定を確認して審査 | 差異または月次へ戻る           |
| 残業設定     | `/overtime/settings`      | owner, HR | 申請単位と締め阻害を設定     | 公開状態と適用日を確認する     |
| レポート     | `/reports`                | owner, HR | 集計と標準CSVを確認          | 月次または給与連携へ進む       |
| 給与連携     | `/payroll-exports`        | owner, HR | 締め済み勤怠を給与形式へ変換 | 設定、検査、生成、履歴へ進む   |
| 利用者       | `/settings/users`         | owner     | ログインと役割を管理         | 紐付けと利用状態を確認する     |
| 監査         | `/audit`                  | owner, HR | 重要操作を追跡               | 条件を変えて履歴を確認する     |
| 通知         | `/notifications`          | all       | 未読と業務イベントを確認     | 対象画面へ移動する             |
| プロフィール | `/profile`                | employee  | 自分の表示情報を更新         | 保存結果を確認する             |
| 利用ガイド   | `/guide`                  | all       | 役割別手順を確認             | 元の業務画面へ戻る             |
| このソフト   | `/about`                  | all       | 版、配布物、対象範囲を確認   | ガイドまたはソースへ進む       |

実装上の完全な定義は`src/lib/screen-catalog.ts`を正とする。
