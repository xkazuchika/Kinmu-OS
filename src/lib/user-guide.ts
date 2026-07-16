import { readFile } from "node:fs/promises";
import path from "node:path";

import type { SessionActor } from "@/lib/authorization";

export type GuideRole = SessionActor["role"];

export type GuideEntry = Readonly<{
  description: string;
  file: string;
  order: number;
  roles: readonly GuideRole[];
  slug: string;
  title: string;
}>;

export const GUIDE_VERSION = "0.2.0";
export const GUIDE_ROOT = path.join(process.cwd(), "docs", "user-guide");

export const guideCatalog = [
  {
    slug: "overview",
    title: "機能一覧と役割",
    description: "Kinmu-OSでできること、役割ごとの権限、現行版の制限を確認します。",
    roles: ["owner", "hr_admin", "employee"],
    order: 10,
    file: "overview.md",
  },
  {
    slug: "admin-setup",
    title: "初期設定と従業員管理",
    description: "組織、利用者、部署、従業員台帳、勤務ルールを準備します。",
    roles: ["owner", "hr_admin"],
    order: 20,
    file: "admin-setup.md",
  },
  {
    slug: "employee-attendance",
    title: "打刻・勤務実績・プロフィール",
    description: "毎日の出退勤と休憩を記録し、自分の勤務実績を確認します。",
    roles: ["employee"],
    order: 30,
    file: "employee-attendance.md",
  },
  {
    slug: "attendance-corrections",
    title: "勤怠修正の申請と審査",
    description: "打刻の追加・変更・削除を申請し、差分を確認して審査します。",
    roles: ["owner", "hr_admin", "employee"],
    order: 40,
    file: "attendance-corrections.md",
  },
  {
    slug: "reports-and-audit",
    title: "レポート・CSV・監査ログ",
    description: "勤怠と残業の集計、CSV出力、操作履歴を確認します。",
    roles: ["owner", "hr_admin"],
    order: 50,
    file: "reports-and-audit.md",
  },
  {
    slug: "troubleshooting",
    title: "トラブル対処",
    description: "ログイン、権限、打刻、申請、CSV、セルフホスト環境を切り分けます。",
    roles: ["owner", "hr_admin", "employee"],
    order: 60,
    file: "troubleshooting.md",
  },
] as const satisfies readonly GuideEntry[];

const validRoles = new Set<GuideRole>(["owner", "hr_admin", "employee"]);

export class GuideConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GuideConfigurationError";
  }
}

export class GuideContentError extends Error {
  constructor(message = "利用ガイドを読み込めませんでした。") {
    super(message);
    this.name = "GuideContentError";
  }
}

export function validateGuideCatalog(catalog: readonly GuideEntry[] = guideCatalog) {
  const slugs = new Set<string>();
  for (const entry of catalog) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.slug) || slugs.has(entry.slug)) {
      throw new GuideConfigurationError("ガイドのslug設定が正しくありません。");
    }
    slugs.add(entry.slug);
    if (entry.roles.length === 0 || entry.roles.some((role) => !validRoles.has(role))) {
      throw new GuideConfigurationError("ガイドの対象役割設定が正しくありません。");
    }
    if (!/^[a-z0-9-]+\.md$/.test(entry.file) || path.basename(entry.file) !== entry.file) {
      throw new GuideConfigurationError("ガイドのファイル設定が正しくありません。");
    }
  }
  return true;
}

export function guidesForRole(role: GuideRole) {
  validateGuideCatalog();
  const preferred: Readonly<Record<GuideRole, readonly string[]>> = {
    employee: ["employee-attendance", "attendance-corrections", "overview", "troubleshooting"],
    hr_admin: [
      "admin-setup",
      "attendance-corrections",
      "reports-and-audit",
      "overview",
      "troubleshooting",
    ],
    owner: [
      "admin-setup",
      "attendance-corrections",
      "reports-and-audit",
      "overview",
      "troubleshooting",
    ],
  };
  const preferredOrder = new Map(preferred[role].map((slug, index) => [slug, index]));
  return [...guideCatalog].sort((left, right) => {
    const leftPriority = preferredOrder.get(left.slug) ?? preferred[role].length + left.order;
    const rightPriority = preferredOrder.get(right.slug) ?? preferred[role].length + right.order;
    return leftPriority - rightPriority;
  });
}

export function guideForSlug(slug: string) {
  return guideCatalog.find((entry) => entry.slug === slug);
}

export async function readGuide(entry: GuideEntry) {
  validateGuideCatalog();
  const resolved = path.resolve(GUIDE_ROOT, entry.file);
  if (!resolved.startsWith(`${path.resolve(GUIDE_ROOT)}${path.sep}`)) {
    throw new GuideContentError();
  }
  try {
    return await readFile(resolved, "utf8");
  } catch {
    throw new GuideContentError();
  }
}

export type GuideInline =
  | Readonly<{ kind: "text"; value: string }>
  | Readonly<{ kind: "code"; value: string }>
  | Readonly<{ href: string; kind: "link"; label: string }>;

export type GuideBlock =
  | Readonly<{ inlines: readonly GuideInline[]; kind: "heading"; level: 1 | 2 | 3 }>
  | Readonly<{ inlines: readonly GuideInline[]; kind: "paragraph" }>
  | Readonly<{ items: readonly (readonly GuideInline[])[]; kind: "list"; ordered: boolean }>
  | Readonly<{ kind: "code"; value: string }>;

const unsupportedBlock = /^(?:>|\|)|^#{4,}\s|^!\[/;
const inlineToken = /(`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\))/g;

function safeGuideHref(target: string) {
  if (target.startsWith("/guide/")) {
    const slug = target.slice("/guide/".length);
    return guideForSlug(slug) ? target : undefined;
  }
  if (/^[a-z0-9-]+\.md$/.test(target)) {
    const slug = target.slice(0, -3);
    return guideForSlug(slug) ? `/guide/${slug}` : undefined;
  }
  return undefined;
}

export function parseGuideInlines(value: string): GuideInline[] {
  const output: GuideInline[] = [];
  let position = 0;
  for (const match of value.matchAll(inlineToken)) {
    const index = match.index ?? 0;
    if (index > position) output.push({ kind: "text", value: value.slice(position, index) });
    const token = match[0];
    if (token.startsWith("`")) {
      output.push({ kind: "code", value: token.slice(1, -1) });
    } else {
      const parts = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      const href = parts ? safeGuideHref(parts[2]) : undefined;
      if (!parts || !href)
        throw new GuideContentError("この記事には表示できないリンクがあります。");
      output.push({ href, kind: "link", label: parts[1] });
    }
    position = index + token.length;
  }
  if (position < value.length) output.push({ kind: "text", value: value.slice(position) });
  return output;
}

export function parseGuideMarkdown(markdown: string): GuideBlock[] {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: GuideBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) code.push(lines[index++]);
      if (index >= lines.length)
        throw new GuideContentError("この記事のコード表示が完了していません。");
      blocks.push({ kind: "code", value: code.join("\n") });
      index += 1;
      continue;
    }
    if (unsupportedBlock.test(line))
      throw new GuideContentError("この記事には未対応の記法があります。");
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length as 1 | 2 | 3,
        inlines: parseGuideInlines(heading[2]),
      });
      index += 1;
      continue;
    }
    const list = /^(?:([-*])|(\d+)\.)\s+(.+)$/.exec(line);
    if (list) {
      const ordered = Boolean(list[2]);
      const items: GuideInline[][] = [];
      while (index < lines.length) {
        const item = /^(?:([-*])|(\d+)\.)\s+(.+)$/.exec(lines[index]);
        if (!item || Boolean(item[2]) !== ordered) break;
        items.push(parseGuideInlines(item[3]));
        index += 1;
      }
      blocks.push({ items, kind: "list", ordered });
      continue;
    }
    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !/^(?:#{1,3}\s|```|[-*]\s|\d+\.\s)/.test(lines[index])
    ) {
      if (unsupportedBlock.test(lines[index]))
        throw new GuideContentError("この記事には未対応の記法があります。");
      paragraph.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ inlines: parseGuideInlines(paragraph.join(" ")), kind: "paragraph" });
  }
  return blocks;
}

export function roleLabel(role: GuideRole) {
  return { owner: "所有者", hr_admin: "労務管理者", employee: "従業員" }[role];
}
