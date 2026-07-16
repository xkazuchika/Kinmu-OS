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
    ).toEqual(["employee-attendance", "attendance-corrections"]);
    expect(
      guidesForRole("hr_admin")
        .slice(0, 3)
        .map((guide) => guide.slug),
    ).toEqual(["admin-setup", "attendance-corrections", "monthly-closing"]);
  });

  it("keeps every catalog file, version, heading and internal link consistent", async () => {
    const knownFiles = new Set<string>(guideCatalog.map((guide) => guide.file));
    for (const guide of guideCatalog) {
      const markdown = await readFile(path.join(GUIDE_ROOT, guide.file), "utf8");
      expect(markdown).toMatch(/^# .+/);
      expect(markdown).toContain(`対象バージョン: ${GUIDE_VERSION}`);
      expect(markdown).toMatch(/^## .+/m);
      for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)]+\.md)\)/g)) {
        expect(knownFiles.has(match[1]), `${guide.file} -> ${match[1]}`).toBe(true);
      }
      expect(() => parseGuideMarkdown(markdown)).not.toThrow();
    }
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
