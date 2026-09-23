import type { SessionActor } from "@/lib/authorization";
import { workDateFor } from "@/lib/time";

export const actionKinds = [
  "overdue_approval",
  "returned_request",
  "open_punch",
  "unresolved_day",
] as const;
export type ActionKind = (typeof actionKinds)[number];
export const actionLabels: Record<ActionKind, string> = {
  overdue_approval: "承認期限超過",
  returned_request: "再申請待ち",
  open_punch: "未退勤",
  unresolved_day: "未解決の勤務日",
};
export type ActionItem = {
  id: string;
  kind: ActionKind;
  employeeId: string;
  employeeName: string;
  departmentId: string | null;
  departmentName: string | null;
  date: string;
  dueAt: string | null;
  reason: string;
  nextOwner: string;
  actionLabel: string;
  href: string;
  related: { label: string; href: string }[];
};
export type ActionPage = {
  items: ActionItem[];
  total: number;
  allTotal: number;
  counts: Record<ActionKind, number>;
  page: number;
  pageSize: number;
  checkedAt: string;
  timezone: string;
  employees: { id: string; name: string }[];
  departments: { id: string; name: string }[];
};
export type ActionActor = Pick<SessionActor, "organizationId" | "role" | "userId">;
export function isActionManager(actor: ActionActor) {
  return actor.role === "owner" || actor.role === "hr_admin";
}
export function attendanceActionKind(
  status: string,
  date: string,
  today: string,
  closed: boolean,
): ActionKind | null {
  if (closed || date >= today) return null;
  return status === "open_punch" ? "open_punch" : status === "unresolved" ? "unresolved_day" : null;
}
export function approvalActionKind(
  status: string,
  dueAt: Date | null,
  now: Date,
  closed: boolean,
): ActionKind | null {
  if (closed) return null;
  if (status === "returned") return "returned_request";
  return status === "pending" && dueAt && dueAt < now ? "overdue_approval" : null;
}
export function reminderClock(now: Date, timezone: string) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(now),
  );
  return { date: workDateFor(now, timezone), eligible: hour >= 9 };
}
export function returnedReminderEligible(returnedAt: Date | null, now: Date, timezone: string) {
  return !!returnedAt && workDateFor(returnedAt, timezone) < workDateFor(now, timezone);
}
