"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import {
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
  { href: "/calendar", icon: ClockIcon, label: "勤務カレンダー" },
  { href: "/leave/manage", icon: ReportIcon, label: "休暇管理" },
  { href: "/leave/reviews", icon: ShieldIcon, label: "休暇審査" },
  { href: "/reports", icon: ReportIcon, label: "レポート" },
  { href: "/settings/users", icon: UserIcon, label: "利用者管理" },
  { href: "/audit", icon: ShieldIcon, label: "監査ログ" },
  { href: "/about", icon: ShieldIcon, label: "このソフト" },
];

const employeeItems = [
  { href: "/", icon: HomeIcon, label: "ホーム" },
  { href: "/attendance/me", icon: ClockIcon, label: "勤務実績" },
  { href: "/leave", icon: ReportIcon, label: "休暇" },
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
          {items.slice(0, 3).map(({ href, icon: ItemIcon, label }) => (
            <li key={href}>
              <Link
                aria-current={isCurrentPath(pathname, href) ? "page" : undefined}
                href={href}
                prefetch={false}
              >
                <ItemIcon />
                <span>{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Navigation>
    </div>
  );
}
