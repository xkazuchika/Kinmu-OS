"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  BellIcon,
  CalendarIcon,
  ChevronDownIcon,
  ClockIcon,
  HelpIcon,
  HomeIcon,
  PayrollIcon,
  PeopleIcon,
  ReportIcon,
  ShieldIcon,
  UserIcon,
} from "@/components/icons";
import { Navigation } from "@/components/ui";
import type { GuideRole } from "@/lib/user-guide";
import {
  navigationForRole,
  navigationGroupForItem,
  screenForPath,
  type NavigationIconKey,
} from "@/lib/screen-catalog";

const STORAGE_KEY = "kinmu:v1:navigation-groups";

const iconByKey = {
  bell: BellIcon,
  calendar: CalendarIcon,
  clock: ClockIcon,
  help: HelpIcon,
  home: HomeIcon,
  payroll: PayrollIcon,
  people: PeopleIcon,
  report: ReportIcon,
  shield: ShieldIcon,
  user: UserIcon,
} satisfies Record<NavigationIconKey, typeof HomeIcon>;

function storedGroupIds(validIds: ReadonlySet<string>) {
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY) ?? "null") as {
      ids?: unknown;
      version?: unknown;
    } | null;
    if (stored?.version !== 1 || !Array.isArray(stored.ids)) return [];
    return stored.ids.filter((id): id is string => typeof id === "string" && validIds.has(id));
  } catch {
    return [];
  }
}

export function NavigationTree({
  label,
  onNavigate,
  pathname,
  role,
  unreadCount,
}: {
  label: string;
  onNavigate?: () => void;
  pathname: string;
  role: GuideRole;
  unreadCount: number;
}) {
  const navigation = navigationForRole(role);
  const activeScreen = screenForPath(pathname, role);
  const activeItemId = activeScreen?.navigationId ?? navigation.home.id;
  const activeGroupId = navigationGroupForItem(role, activeItemId)?.id;
  const validGroupIds = useMemo(
    () => new Set(navigation.groups.map((group) => group.id)),
    [navigation.groups],
  );
  const [openGroupIds, setOpenGroupIds] = useState<ReadonlySet<string>>(
    () => new Set(activeGroupId ? [activeGroupId] : []),
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const ids = storedGroupIds(validGroupIds);
      if (activeGroupId && !ids.includes(activeGroupId)) ids.push(activeGroupId);
      setOpenGroupIds(new Set(ids));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeGroupId, validGroupIds]);

  function toggleGroup(groupId: string) {
    setOpenGroupIds((current) => {
      const next = new Set(current);
      if (next.has(groupId) && groupId !== activeGroupId) next.delete(groupId);
      else next.add(groupId);
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ids: [...next], version: 1 }));
      return next;
    });
  }

  const HomeItemIcon = iconByKey[navigation.home.icon];

  return (
    <Navigation label={label}>
      <ul className="app-nav-tree">
        <li>
          <Link
            aria-current={activeItemId === navigation.home.id ? "page" : undefined}
            className="app-nav-link"
            href={navigation.home.href}
            onClick={onNavigate}
            prefetch={false}
          >
            <HomeItemIcon />
            <span>{navigation.home.label}</span>
          </Link>
        </li>
        {navigation.groups.map((group) => {
          const expanded = openGroupIds.has(group.id);
          const GroupIcon = iconByKey[group.icon];
          const groupIsCurrent = group.id === activeGroupId;
          const controlledId = `${label.replaceAll(/\s/g, "-")}-${group.id}`;
          return (
            <li className="app-nav-group" data-current={groupIsCurrent || undefined} key={group.id}>
              <button
                aria-controls={controlledId}
                aria-expanded={expanded}
                className="app-nav-group-button"
                onClick={() => toggleGroup(group.id)}
                type="button"
              >
                <GroupIcon />
                <span>{group.label}</span>
                <ChevronDownIcon className="app-nav-chevron" />
              </button>
              {expanded ? (
                <ul className="app-nav-children" id={controlledId}>
                  {group.items.map((item) => {
                    const ItemIcon = iconByKey[item.icon];
                    const current = item.id === activeItemId;
                    return (
                      <li key={item.id}>
                        <Link
                          aria-current={current ? "page" : undefined}
                          className="app-nav-link app-nav-link--child"
                          href={item.href}
                          onClick={onNavigate}
                          prefetch={false}
                        >
                          <ItemIcon />
                          <span>{item.label}</span>
                          {item.id === "notifications" && unreadCount > 0 ? (
                            <span
                              aria-label={`${unreadCount}件の未読通知`}
                              className="notification-badge"
                            >
                              {unreadCount > 99 ? "99+" : unreadCount}
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </Navigation>
  );
}
