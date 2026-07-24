import type { GuideRole } from "@/lib/user-guide";

export type NavigationIconKey =
  | "bell"
  | "calendar"
  | "clock"
  | "help"
  | "home"
  | "payroll"
  | "people"
  | "report"
  | "shield"
  | "user";

export type NavigationItem = Readonly<{
  href: string;
  icon: NavigationIconKey;
  id: string;
  label: string;
}>;

export type NavigationGroup = Readonly<{
  icon: NavigationIconKey;
  id: string;
  items: readonly NavigationItem[];
  label: string;
}>;

export type RoleNavigation = Readonly<{
  groups: readonly NavigationGroup[];
  home: NavigationItem;
  mobile: readonly string[];
}>;

type GuideSlug =
  | "admin-setup"
  | "attendance-corrections"
  | "employee-attendance"
  | "leave-management"
  | "leave-requests"
  | "monthly-closing"
  | "notifications"
  | "overtime-management"
  | "overtime-requests"
  | "overview"
  | "payroll-exports"
  | "reports-and-audit"
  | "troubleshooting"
  | "work-calendar";

export const screenGuideSlugs = new Set<GuideSlug>([
  "admin-setup",
  "attendance-corrections",
  "employee-attendance",
  "leave-management",
  "leave-requests",
  "monthly-closing",
  "notifications",
  "overtime-management",
  "overtime-requests",
  "overview",
  "payroll-exports",
  "reports-and-audit",
  "troubleshooting",
  "work-calendar",
]);

export type ScreenDefinition = Readonly<{
  area: string;
  completion: string;
  guideSlug: GuideSlug;
  id: string;
  navigationId: string;
  pattern: string;
  primaryAction: string;
  purpose: string;
  roles: readonly GuideRole[];
  title: string;
}>;

const managerRoles = ["owner", "hr_admin"] as const;
const allRoles = ["owner", "hr_admin", "employee"] as const;

const managementNavigation: RoleNavigation = {
  home: { href: "/", icon: "home", id: "home", label: "ホーム" },
  mobile: ["home", "attendance-status", "attendance-corrections", "notifications"],
  groups: [
    {
      id: "daily-attendance",
      icon: "clock",
      label: "日々の勤怠",
      items: [
        { href: "/attendance", icon: "clock", id: "attendance-status", label: "勤怠状況" },
        { href: "/calendar", icon: "calendar", id: "work-calendar", label: "勤務カレンダー" },
      ],
    },
    {
      id: "reviews",
      icon: "shield",
      label: "申請と審査",
      items: [
        {
          href: "/attendance/corrections",
          icon: "report",
          id: "attendance-corrections",
          label: "勤怠申請",
        },
        { href: "/leave/reviews", icon: "report", id: "leave-reviews", label: "休暇審査" },
        {
          href: "/overtime/reviews",
          icon: "shield",
          id: "overtime-reviews",
          label: "残業審査",
        },
      ],
    },
    {
      id: "people-settings",
      icon: "people",
      label: "従業員・勤務設定",
      items: [
        { href: "/employees", icon: "people", id: "employees", label: "従業員" },
        {
          href: "/attendance/rules",
          icon: "clock",
          id: "work-rules",
          label: "勤務ルール",
        },
        { href: "/leave/manage", icon: "report", id: "leave-manage", label: "休暇管理" },
        {
          href: "/overtime/settings",
          icon: "clock",
          id: "overtime-settings",
          label: "残業申請設定",
        },
      ],
    },
    {
      id: "monthly-exports",
      icon: "report",
      label: "月次・出力",
      items: [
        {
          href: "/attendance#monthly-closing",
          icon: "calendar",
          id: "monthly-closing",
          label: "月次締め",
        },
        { href: "/reports", icon: "report", id: "reports", label: "レポート" },
        {
          href: "/payroll-exports",
          icon: "payroll",
          id: "payroll-exports",
          label: "給与連携",
        },
      ],
    },
    {
      id: "system",
      icon: "shield",
      label: "システム管理",
      items: [
        { href: "/settings/users", icon: "user", id: "users", label: "利用者管理" },
        { href: "/audit", icon: "shield", id: "audit", label: "監査ログ" },
        { href: "/notifications", icon: "bell", id: "notifications", label: "通知" },
        { href: "/guide", icon: "help", id: "guide", label: "利用ガイド" },
        { href: "/about", icon: "help", id: "about", label: "このソフト" },
      ],
    },
  ],
};

const employeeNavigation: RoleNavigation = {
  home: { href: "/", icon: "home", id: "home", label: "ホーム" },
  mobile: ["home", "my-attendance", "overtime-request", "notifications"],
  groups: [
    {
      id: "my-work",
      icon: "clock",
      label: "勤務",
      items: [
        {
          href: "/attendance/me",
          icon: "clock",
          id: "my-attendance",
          label: "勤務実績",
        },
      ],
    },
    {
      id: "my-requests",
      icon: "report",
      label: "申請",
      items: [
        {
          href: "/attendance/corrections",
          icon: "report",
          id: "attendance-corrections",
          label: "勤怠修正",
        },
        { href: "/leave", icon: "calendar", id: "leave-request", label: "休暇" },
        {
          href: "/overtime",
          icon: "report",
          id: "overtime-request",
          label: "残業・休日出勤",
        },
      ],
    },
    {
      id: "my-account",
      icon: "user",
      label: "自分の情報",
      items: [
        { href: "/notifications", icon: "bell", id: "notifications", label: "通知" },
        { href: "/profile", icon: "user", id: "profile", label: "プロフィール" },
        { href: "/guide", icon: "help", id: "guide", label: "利用ガイド" },
        { href: "/about", icon: "help", id: "about", label: "このソフト" },
      ],
    },
  ],
};

export const screenCatalog = [
  {
    id: "home",
    pattern: "/",
    title: "ホーム",
    area: "ホーム",
    roles: allRoles,
    purpose: "現在の勤怠状況を確認し、必要な対応へ進みます。",
    completion: "次に必要な業務または日常操作を開ける",
    primaryAction: "次にやることを確認",
    guideSlug: "overview",
    navigationId: "home",
  },
  {
    id: "setup",
    pattern: "/setup",
    title: "初期設定",
    area: "従業員・勤務設定",
    roles: managerRoles,
    purpose: "組織と最初の管理者を準備します。",
    completion: "管理者としてログインし、従業員設定へ進める",
    primaryAction: "初期設定を完了",
    guideSlug: "admin-setup",
    navigationId: "home",
  },
  {
    id: "employee-import",
    pattern: "/employees/import",
    title: "従業員CSV取込",
    area: "従業員・勤務設定",
    roles: managerRoles,
    purpose: "従業員台帳を一括検査して反映します。",
    completion: "取込結果を確認し、従業員一覧へ戻れる",
    primaryAction: "CSVを検査",
    guideSlug: "admin-setup",
    navigationId: "employees",
  },
  {
    id: "departments",
    pattern: "/employees/departments",
    title: "部署管理",
    area: "従業員・勤務設定",
    roles: managerRoles,
    purpose: "従業員の主所属に使用する部署を管理します。",
    completion: "部署を従業員へ割り当てられる",
    primaryAction: "部署を追加",
    guideSlug: "admin-setup",
    navigationId: "employees",
  },
  {
    id: "employee-detail",
    pattern: "/employees/[employeeId]",
    title: "従業員詳細",
    area: "従業員・勤務設定",
    roles: managerRoles,
    purpose: "従業員の基本情報、雇用情報、所属を確認・更新します。",
    completion: "保存結果を確認し、一覧へ戻れる",
    primaryAction: "従業員情報を保存",
    guideSlug: "admin-setup",
    navigationId: "employees",
  },
  {
    id: "employees",
    pattern: "/employees",
    title: "従業員",
    area: "従業員・勤務設定",
    roles: managerRoles,
    purpose: "従業員の基本情報、雇用情報、主所属を管理します。",
    completion: "対象従業員または次の設定を開ける",
    primaryAction: "従業員を追加",
    guideSlug: "admin-setup",
    navigationId: "employees",
  },
  {
    id: "work-rules",
    pattern: "/attendance/rules",
    title: "勤務ルール",
    area: "従業員・勤務設定",
    roles: managerRoles,
    purpose: "勤務時間と休憩の基準を設定します。",
    completion: "適用開始日と影響範囲を確認できる",
    primaryAction: "勤務ルールを保存",
    guideSlug: "admin-setup",
    navigationId: "work-rules",
  },
  {
    id: "my-attendance",
    pattern: "/attendance/me",
    title: "勤務実績",
    area: "勤務",
    roles: ["employee"],
    purpose: "月ごとの実労働、所定時間、残業を確認します。",
    completion: "必要な日を確認し、修正申請へ進める",
    primaryAction: "対象月を確認",
    guideSlug: "employee-attendance",
    navigationId: "my-attendance",
  },
  {
    id: "attendance-corrections",
    pattern: "/attendance/corrections",
    title: "勤怠修正",
    area: "申請と審査",
    roles: allRoles,
    purpose: "打刻の変更を申請し、または申請差分を審査します。",
    completion: "申請または審査結果を確認できる",
    primaryAction: "対象の申請を確認",
    guideSlug: "attendance-corrections",
    navigationId: "attendance-corrections",
  },
  {
    id: "attendance",
    pattern: "/attendance",
    title: "勤怠状況",
    area: "日々の勤怠",
    roles: managerRoles,
    purpose: "従業員の勤務状況を確認し、未退勤や未解決の日を処理します。",
    completion: "阻害要因を解消し、月次締めへ進める",
    primaryAction: "対応が必要な勤怠を確認",
    guideSlug: "monthly-closing",
    navigationId: "attendance-status",
  },
  {
    id: "calendar",
    pattern: "/calendar",
    title: "勤務カレンダー",
    area: "日々の勤怠",
    roles: managerRoles,
    purpose: "勤務日、休日、会社・従業員別の例外を設定します。",
    completion: "有効化した日区分を確認できる",
    primaryAction: "カレンダーを確認",
    guideSlug: "work-calendar",
    navigationId: "work-calendar",
  },
  {
    id: "leave-manage",
    pattern: "/leave/manage",
    title: "休暇管理",
    area: "従業員・勤務設定",
    roles: managerRoles,
    purpose: "休暇種別、付与、調整、残高を管理します。",
    completion: "残高と台帳の反映を確認できる",
    primaryAction: "休暇設定を確認",
    guideSlug: "leave-management",
    navigationId: "leave-manage",
  },
  {
    id: "leave-reviews",
    pattern: "/leave/reviews",
    title: "休暇審査",
    area: "申請と審査",
    roles: managerRoles,
    purpose: "残高、対象日、競合を確認して休暇申請を審査します。",
    completion: "審査結果を確認し、一覧または月次へ戻れる",
    primaryAction: "審査待ちを確認",
    guideSlug: "leave-requests",
    navigationId: "leave-reviews",
  },
  {
    id: "leave-request",
    pattern: "/leave",
    title: "休暇",
    area: "申請",
    roles: ["employee"],
    purpose: "休暇残高を確認して、全日または半日の休暇を申請します。",
    completion: "提出後の審査待ち状態を確認できる",
    primaryAction: "休暇を申請",
    guideSlug: "leave-requests",
    navigationId: "leave-request",
  },
  {
    id: "overtime-settings",
    pattern: "/overtime/settings",
    title: "残業申請設定",
    area: "従業員・勤務設定",
    roles: managerRoles,
    purpose: "残業・休日出勤申請の単位、事前申請、締め阻害を設定します。",
    completion: "公開状態と適用開始日を確認できる",
    primaryAction: "残業申請設定を保存",
    guideSlug: "overtime-management",
    navigationId: "overtime-settings",
  },
  {
    id: "overtime-reviews",
    pattern: "/overtime/reviews",
    title: "残業審査",
    area: "申請と審査",
    roles: managerRoles,
    purpose: "予定時間と勤務予定を確認して残業・休日出勤申請を審査します。",
    completion: "審査結果と実績差異を確認できる",
    primaryAction: "審査待ちを確認",
    guideSlug: "overtime-management",
    navigationId: "overtime-reviews",
  },
  {
    id: "overtime-request",
    pattern: "/overtime",
    title: "残業・休日出勤",
    area: "申請",
    roles: ["employee"],
    purpose: "勤務予定を確認して残業または休日出勤を申請します。",
    completion: "提出後の審査状態と実績差異を確認できる",
    primaryAction: "残業・休日出勤を申請",
    guideSlug: "overtime-requests",
    navigationId: "overtime-request",
  },
  {
    id: "payroll-mappings",
    pattern: "/payroll-exports/profiles/[profileId]/mappings",
    title: "外部従業員コード",
    area: "月次・出力",
    roles: managerRoles,
    purpose: "給与ソフトの従業員コードを対応付けます。",
    completion: "全従業員のコード対応を検査できる",
    primaryAction: "コード対応を保存",
    guideSlug: "payroll-exports",
    navigationId: "payroll-exports",
  },
  {
    id: "payroll-profile-detail",
    pattern: "/payroll-exports/profiles/[profileId]",
    title: "給与プロファイル",
    area: "月次・出力",
    roles: managerRoles,
    purpose: "給与連携CSVの列、変換、文字コードを設定します。",
    completion: "検査済みの公開版を作成できる",
    primaryAction: "プロファイルを検査",
    guideSlug: "payroll-exports",
    navigationId: "payroll-exports",
  },
  {
    id: "payroll-profiles",
    pattern: "/payroll-exports/profiles",
    title: "給与プロファイル",
    area: "月次・出力",
    roles: managerRoles,
    purpose: "給与連携CSVの設定版を管理します。",
    completion: "使用する公開版を確認できる",
    primaryAction: "プロファイルを作成",
    guideSlug: "payroll-exports",
    navigationId: "payroll-exports",
  },
  {
    id: "payroll-inspect",
    pattern: "/payroll-exports/inspect",
    title: "給与連携の検査・生成",
    area: "月次・出力",
    roles: managerRoles,
    purpose: "締めリビジョンを全件検査し、給与連携CSVを生成します。",
    completion: "run IDとファイルハッシュを確認できる",
    primaryAction: "給与連携CSVを検査",
    guideSlug: "payroll-exports",
    navigationId: "payroll-exports",
  },
  {
    id: "payroll-runs",
    pattern: "/payroll-exports/runs",
    title: "給与連携の出力履歴",
    area: "月次・出力",
    roles: managerRoles,
    purpose: "過去の出力runと再ダウンロード結果を確認します。",
    completion: "締めリビジョンとハッシュを照合できる",
    primaryAction: "出力履歴を確認",
    guideSlug: "payroll-exports",
    navigationId: "payroll-exports",
  },
  {
    id: "payroll-exports",
    pattern: "/payroll-exports",
    title: "給与連携",
    area: "月次・出力",
    roles: managerRoles,
    purpose: "締め済み勤怠を給与ソフト向けCSVへ安全に変換します。",
    completion: "設定、コード対応、検査、生成、履歴へ進める",
    primaryAction: "給与連携を準備",
    guideSlug: "payroll-exports",
    navigationId: "payroll-exports",
  },
  {
    id: "reports",
    pattern: "/reports",
    title: "レポート",
    area: "月次・出力",
    roles: managerRoles,
    purpose: "勤怠、残業、休暇の集計と標準CSVを確認します。",
    completion: "対象条件と出力結果を確認できる",
    primaryAction: "レポートを確認",
    guideSlug: "reports-and-audit",
    navigationId: "reports",
  },
  {
    id: "users",
    pattern: "/settings/users",
    title: "利用者管理",
    area: "システム管理",
    roles: ["owner"],
    purpose: "ログイン、役割、従業員との紐付けを管理します。",
    completion: "利用状態と権限を確認できる",
    primaryAction: "利用者を追加",
    guideSlug: "admin-setup",
    navigationId: "users",
  },
  {
    id: "audit",
    pattern: "/audit",
    title: "監査ログ",
    area: "システム管理",
    roles: managerRoles,
    purpose: "重要な操作を条件で検索し、追記型の履歴を確認します。",
    completion: "対象操作と変更要約を確認できる",
    primaryAction: "監査ログを検索",
    guideSlug: "reports-and-audit",
    navigationId: "audit",
  },
  {
    id: "notifications",
    pattern: "/notifications",
    title: "通知",
    area: "自分の情報",
    roles: allRoles,
    purpose: "未読の業務イベントを確認し、対象画面へ進みます。",
    completion: "通知を既読にして対象を確認できる",
    primaryAction: "未読通知を確認",
    guideSlug: "notifications",
    navigationId: "notifications",
  },
  {
    id: "profile",
    pattern: "/profile",
    title: "プロフィール",
    area: "自分の情報",
    roles: ["employee"],
    purpose: "自分の表示名と連絡先を確認・更新します。",
    completion: "保存結果を確認できる",
    primaryAction: "プロフィールを保存",
    guideSlug: "employee-attendance",
    navigationId: "profile",
  },
  {
    id: "guide-article",
    pattern: "/guide/[slug]",
    title: "利用ガイド",
    area: "システム管理",
    roles: allRoles,
    purpose: "現在の業務に対応する手順と制限を確認します。",
    completion: "元の許可済み業務画面へ戻れる",
    primaryAction: "手順を確認",
    guideSlug: "overview",
    navigationId: "guide",
  },
  {
    id: "guide",
    pattern: "/guide",
    title: "利用ガイド",
    area: "システム管理",
    roles: allRoles,
    purpose: "役割に合う機能説明、操作手順、トラブル対処を確認します。",
    completion: "必要な記事または元の業務画面へ進める",
    primaryAction: "ガイドを選択",
    guideSlug: "overview",
    navigationId: "guide",
  },
  {
    id: "about",
    pattern: "/about",
    title: "このソフト",
    area: "システム管理",
    roles: allRoles,
    purpose: "実行中の版、配布物、対応ソース、対象範囲を確認します。",
    completion: "利用ガイドまたは対応ソースへ進める",
    primaryAction: "利用ガイドを開く",
    guideSlug: "overview",
    navigationId: "about",
  },
] as const satisfies readonly ScreenDefinition[];

export function navigationForRole(role: GuideRole): RoleNavigation {
  return role === "employee" ? employeeNavigation : managementNavigation;
}

export function screenPathMatches(pattern: string, pathname: string) {
  const patternParts = pattern.split("/").filter(Boolean);
  const pathParts = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every(
    (part, index) => (part.startsWith("[") && part.endsWith("]")) || part === pathParts[index],
  );
}

export function screenForPath(pathname: string, role: GuideRole) {
  return screenCatalog.find(
    (screen) =>
      (screen.roles as readonly GuideRole[]).includes(role) &&
      screenPathMatches(screen.pattern, pathname),
  );
}

export function navigationGroupForItem(role: GuideRole, itemId: string) {
  return navigationForRole(role).groups.find((group) =>
    group.items.some((item) => item.id === itemId),
  );
}

export function validateScreenCatalog() {
  const ids = new Set<string>();
  const patterns = new Set<string>();

  for (const screen of screenCatalog) {
    if (ids.has(screen.id) || patterns.has(screen.pattern)) {
      throw new Error("画面カタログのIDまたはパスが重複しています。");
    }
    ids.add(screen.id);
    patterns.add(screen.pattern);
    if (!screenGuideSlugs.has(screen.guideSlug)) {
      throw new Error(`画面${screen.id}に対応する利用ガイドがありません。`);
    }
    for (const role of screen.roles) {
      const navigation = navigationForRole(role);
      const navigationIds = new Set([
        navigation.home.id,
        ...navigation.groups.flatMap((group) => group.items.map((item) => item.id)),
      ]);
      if (!navigationIds.has(screen.navigationId)) {
        throw new Error(`画面${screen.id}に対応するナビゲーション項目がありません。`);
      }
    }
  }
  return true;
}
