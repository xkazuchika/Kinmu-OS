"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import {
  BellIcon,
  ClockIcon,
  HomeIcon,
  PeopleIcon,
  ReportIcon,
  ShieldIcon,
  UserIcon,
} from "@/components/icons";
import { LogoutButton } from "@/components/logout-button";
import { Navigation } from "@/components/ui";
import type { SessionActor } from "@/lib/authorization";

const managementItems = [
  { href: "/", icon: HomeIcon, label: "ホーム" },
  { href: "/employees", icon: PeopleIcon, label: "従業員" },
  { href: "/attendance", icon: ClockIcon, label: "勤怠" },
  { href: "/attendance/corrections", icon: ReportIcon, label: "勤怠申請" },
  { href: "/overtime/reviews", icon: ShieldIcon, label: "残業審査" },
  { href: "/overtime/settings", icon: ClockIcon, label: "残業申請設定" },
  { href: "/calendar", icon: ClockIcon, label: "勤務カレンダー" },
  { href: "/leave/manage", icon: ReportIcon, label: "休暇管理" },
  { href: "/leave/reviews", icon: ShieldIcon, label: "休暇審査" },
  { href: "/reports", icon: ReportIcon, label: "レポート" },
  { href: "/settings/users", icon: UserIcon, label: "利用者管理" },
  { href: "/audit", icon: ShieldIcon, label: "監査ログ" },
  { href: "/notifications", icon: BellIcon, label: "通知" },
  { href: "/about", icon: ShieldIcon, label: "このソフト" },
];

const employeeItems = [
  { href: "/", icon: HomeIcon, label: "ホーム" },
  { href: "/attendance/me", icon: ClockIcon, label: "勤務実績" },
  { href: "/overtime", icon: ReportIcon, label: "残業・休日出勤" },
  { href: "/leave", icon: ReportIcon, label: "休暇" },
  { href: "/notifications", icon: BellIcon, label: "通知" },
  { href: "/profile", icon: UserIcon, label: "プロフィール" },
  { href: "/about", icon: ShieldIcon, label: "このソフト" },
];

type ShellActor = Pick<SessionActor, "displayName" | "role">;

function isCurrentPath(pathname: string, href: string) {
  if (href === "/attendance") {
    return pathname === href || pathname.startsWith("/attendance/rules");
  }
  return href === "/" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({ actor, children }: { actor: ShellActor; children: ReactNode }) {
  const pathname = usePathname();
  const items = actor.role === "employee" ? employeeItems : managementItems;
  const [unreadCount, setUnreadCount] = useState(0);
  const loadUnreadCount = useCallback(async () => {
    const response = await fetch("/api/notifications?limit=1");
    if (!response.ok) return;
    const result = (await response.json()) as { notifications?: { unreadCount?: number } };
    setUnreadCount(result.notifications?.unreadCount ?? 0);
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => void loadUnreadCount(), 0);
    window.addEventListener("kinmu:notifications-read", loadUnreadCount);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("kinmu:notifications-read", loadUnreadCount);
    };
  }, [loadUnreadCount]);
  const mobileHrefs =
    actor.role === "employee"
      ? ["/", "/attendance/me", "/overtime", "/notifications"]
      : ["/", "/attendance", "/overtime/reviews", "/notifications"];
  const mobileItems = items.filter((item) => mobileHrefs.includes(item.href));

  return (
    <div className={`app-shell app-shell--${actor.role}`}>
      <aside className="app-sidebar">
        <Link className="app-brand" href="/">
          KINMU-OS
        </Link>
        <Navigation label="メインメニュー">
          <ul>
            {items.map(({ href, icon: ItemIcon, label }) => (
              <li key={href}>
                <Link
                  aria-current={isCurrentPath(pathname, href) ? "page" : undefined}
                  className="app-nav-link"
                  href={href}
                  prefetch={false}
                >
                  <ItemIcon />
                  <span>{label}</span>
                  {href === "/notifications" && unreadCount > 0 ? (
                    <span aria-label={`${unreadCount}件の未読通知`} className="notification-badge">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </Navigation>
      </aside>
      <header className="app-topbar">
        <div className="app-user">
          <UserIcon />
          <span>{actor.displayName}</span>
        </div>
        <LogoutButton />
      </header>
      <div className="app-content">{children}</div>
      <Navigation label="モバイルメニュー">
        <ul className="app-bottom-nav">
          {mobileItems.map(({ href, icon: ItemIcon, label }) => (
            <li key={href}>
              <Link
                aria-current={isCurrentPath(pathname, href) ? "page" : undefined}
                href={href}
                prefetch={false}
              >
                <ItemIcon />
                <span>{href === "/overtime" ? "残業申請" : label}</span>
                {href === "/notifications" && unreadCount > 0 ? (
                  <span aria-label={`${unreadCount}件の未読通知`} className="notification-badge">
                    {unreadCount > 99 ? "99+" : unreadCount}
                  </span>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      </Navigation>
    </div>
  );
}
