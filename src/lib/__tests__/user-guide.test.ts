import { readFile } from "node:fs/promises";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  GuideConfigurationError,
  GuideContentError,
  GUIDE_ROOT,
  GUIDE_VERSION,
  guideCatalog,
  guidesForRole,
  parseGuideMarkdown,
  validateGuideCatalog,
} from "@/lib/user-guide";

describe("user guide catalog", () => {
  it("has unique safe slugs, roles and file names", () => {
    expect(validateGuideCatalog()).toBe(true);
    expect(new Set(guideCatalog.map((guide) => guide.slug)).size).toBe(guideCatalog.length);
  });

  it("rejects duplicate slugs and unsafe files", () => {
    const duplicate = [guideCatalog[0], { ...guideCatalog[0], file: "../secret.md" }];
    expect(() => validateGuideCatalog(duplicate)).toThrow(GuideConfigurationError);
  });

  it("prioritizes employee and administrator workflows", () => {
    expect(
      guidesForRole("employee")
        .slice(0, 2)
        .map((guide) => guide.slug),
    ).toEqual(["overtime-requests", "notifications"]);
    expect(
      guidesForRole("hr_admin")
        .slice(0, 3)
        .map((guide) => guide.slug),
    ).toEqual(["admin-setup", "work-calendar", "leave-management"]);
    expect(guideCatalog.map((guide) => guide.slug)).toEqual(
      expect.arrayContaining(["overtime-requests", "overtime-management", "notifications"]),
    );
  });

  it("keeps every catalog file, version, heading and internal link consistent", async () => {
    const knownFiles = new Set<string>(guideCatalog.map((guide) => guide.file));
    for (const guide of guideCatalog) {
      const markdown = await readFile(path.join(GUIDE_ROOT, guide.file), "utf8");
      expect(markdown).toMatch(/^# .+/);
      expect(markdown).toContain(`対象バージョン: ${GUIDE_VERSION}`);
      expect(markdown).toMatch(/^## .+/m);
      expect(markdown).toContain("## 現行版の制限");
      expect(markdown).toMatch(/法令|就業規則/);
      for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)) {
        expect(knownFiles.has(match[1]), `${guide.file} -> ${match[1]}`).toBe(true);
      }
      expect(() => parseGuideMarkdown(markdown)).not.toThrow();
    }
    const overview = await readFile(path.join(GUIDE_ROOT, "overview.md"), "utf8");
    expect(overview).toContain("時間単位休暇");
    expect(overview).toContain("自動法令判定");
    expect(overview).toContain("多段承認");
    expect(overview).toContain("代理申請");
    expect(overview).toContain("アプリ内通知");
  });

  it("includes guide Markdown in the production standalone output", async () => {
    const config = await readFile(path.join(process.cwd(), "next.config.ts"), "utf8");
    expect(config).toContain('output: "standalone"');
    expect(config).toContain('"./docs/user-guide/**/*.md"');
  });
});

describe("safe guide Markdown", () => {
  it("parses headings, paragraphs, lists, steps, code and internal links", () => {
    const blocks = parseGuideMarkdown(
      "# 見出し\n\n本文 `code` [一覧](overview.md)\n\n- 項目\n\n1. 手順\n\n```\npnpm test\n```",
    );
    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "paragraph",
      "list",
      "list",
      "code",
    ]);
    expect(blocks[1]).toMatchObject({
      inlines: expect.arrayContaining([{ href: "/guide/overview", kind: "link", label: "一覧" }]),
    });
  });

  it("leaves raw HTML inert as text", () => {
    const blocks = parseGuideMarkdown("<script>alert('xss')</script>");
    expect(blocks).toEqual([
      { inlines: [{ kind: "text", value: "<script>alert('xss')</script>" }], kind: "paragraph" },
    ]);
  });

  it("rejects dangerous URLs and unsupported blocks", () => {
    expect(() => parseGuideMarkdown("[危険](javascript:alert(1))")).toThrow(GuideContentError);
    expect(() => parseGuideMarkdown("> 引用")).toThrow(GuideContentError);
    expect(() => parseGuideMarkdown("| 表 |\n| --- |")).toThrow(GuideContentError);
  });
});
