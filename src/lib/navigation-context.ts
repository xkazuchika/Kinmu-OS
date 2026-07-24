import { screenForPath } from "@/lib/screen-catalog";
import type { GuideRole } from "@/lib/user-guide";

const RETURN_QUERY_KEYS = new Set([
  "date",
  "departmentId",
  "employeeId",
  "month",
  "order",
  "overtimeStatus",
  "page",
  "requestStatus",
  "sort",
  "status",
]);

export function safeReturnTo(value: string | string[] | undefined, role: GuideRole) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) {
    return undefined;
  }

  let target: URL;
  try {
    target = new URL(value, "https://kinmu-os.local");
  } catch {
    return undefined;
  }

  if (target.origin !== "https://kinmu-os.local" || !screenForPath(target.pathname, role)) {
    return undefined;
  }

  const safeSearch = new URLSearchParams();
  for (const [key, item] of target.searchParams) {
    if (RETURN_QUERY_KEYS.has(key)) safeSearch.append(key, item);
  }

  const query = safeSearch.toString();
  return `${target.pathname}${query ? `?${query}` : ""}`;
}
