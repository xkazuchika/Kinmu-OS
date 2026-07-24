import { readdirSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  navigationForRole,
  screenCatalog,
  screenGuideSlugs,
  screenForPath,
  screenPathMatches,
  validateScreenCatalog,
} from "@/lib/screen-catalog";
import { guideCatalog } from "@/lib/user-guide";

function appRouteForPage(file: string) {
  const relative = file.replaceAll(path.sep, "/").replace(/\/page\.tsx$/, "");
  return relative === "page.tsx" ? "/" : `/${relative}`;
}

describe("screen catalog", () => {
  it("has unique routes, valid guides, and role navigation targets", () => {
    expect(validateScreenCatalog()).toBe(true);
    expect([...screenGuideSlugs].sort()).toEqual(guideCatalog.map((guide) => guide.slug).sort());
  });

  it("covers every authenticated page", () => {
    const pageFiles = readdirSync(path.join(process.cwd(), "src", "app"), {
      recursive: true,
    })
      .map(String)
      .filter((file) => file.endsWith("page.tsx"))
      .filter((file) => !file.startsWith("login/") && !file.startsWith("activate/"));
    const catalogPatterns = new Set(screenCatalog.map((screen) => screen.pattern.slice(1)));
    const missing = pageFiles
      .map(appRouteForPage)
      .filter((route) => route !== "/")
      .filter((route) => !catalogPatterns.has(route.slice(1)));

    expect(missing).toEqual([]);
  });

  it("matches dynamic paths without matching descendants", () => {
    expect(screenPathMatches("/employees/[employeeId]", "/employees/employee-1")).toBe(true);
    expect(screenPathMatches("/employees", "/employees/employee-1")).toBe(false);
  });

  it("returns only screens allowed for the role", () => {
    expect(screenForPath("/attendance", "hr_admin")?.id).toBe("attendance");
    expect(screenForPath("/attendance", "employee")).toBeUndefined();
    expect(screenForPath("/leave", "employee")?.id).toBe("leave-request");
  });

  it("keeps employee navigation free of management categories", () => {
    const labels = navigationForRole("employee").groups.map((group) => group.label);
    expect(labels).toEqual(["勤務", "申請", "自分の情報"]);
  });
});
