"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type ReactNode,
} from "react";

import { UnsavedChangesProvider } from "@/components/form-state";
import {
  BellIcon,
  CalendarIcon,
  ChevronRightIcon,
  ClockIcon,
  CloseIcon,
  HelpIcon,
  HomeIcon,
  MenuIcon,
  PayrollIcon,
  PeopleIcon,
  ReportIcon,
  ShieldIcon,
  UserIcon,
} from "@/components/icons";
import { LogoutButton } from "@/components/logout-button";
import { NavigationTree } from "@/components/navigation-tree";
import { Navigation } from "@/components/ui";
import type { SessionActor } from "@/lib/authorization";
import type { GuideRole } from "@/lib/user-guide";
import { navigationForRole, screenForPath, type NavigationIconKey } from "@/lib/screen-catalog";

type ShellActor = Pick<SessionActor, "displayName" | "role">;

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

function Drawer({
  closeButtonRef,
  onClose,
  open,
  pathname,
  role,
  unreadCount,
}: {
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onClose: () => void;
  open: boolean;
  pathname: string;
  role: GuideRole;
  unreadCount: number;
}) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = Array.from(
        drawerRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      const first = controls.at(0);
      const last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeButtonRef, open]);

  if (!open) return null;

  return (
    <div className="app-menu-backdrop" onMouseDown={onClose}>
      <div
        aria-label="すべてのメニュー"
        aria-modal="true"
        className="app-menu-drawer"
        onMouseDown={(event) => event.stopPropagation()}
        ref={drawerRef}
        role="dialog"
      >
        <div className="app-menu-drawer__header">
          <Link className="app-brand" href="/" onClick={onClose}>
            KINMU-OS
          </Link>
          <button
            aria-label="すべてのメニューを閉じる"
            className="app-icon-button app-menu-close"
            onClick={onClose}
            ref={closeButtonRef}
            type="button"
          >
            <CloseIcon />
            <span>閉じる</span>
          </button>
        </div>
        <h2>すべてのメニュー</h2>
        <NavigationTree
          label="すべてのメニュー"
          onNavigate={onClose}
          pathname={pathname}
          role={role}
          unreadCount={unreadCount}
        />
      </div>
    </div>
  );
}

function AppShellLayout({ actor, children }: { actor: ShellActor; children: ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navigation = navigationForRole(actor.role);
  const activeScreen = screenForPath(pathname, actor.role);
  const activeItemId = activeScreen?.navigationId ?? navigation.home.id;
  const [unreadCount, setUnreadCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const allNavigationItems = useMemo(
    () => [navigation.home, ...navigation.groups.flatMap((group) => group.items)],
    [navigation],
  );
  const mobileItems = navigation.mobile
    .map((id) => allNavigationItems.find((item) => item.id === id))
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
  const currentIsInMobile = mobileItems.some((item) => item.id === activeItemId);

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

  function closeMenu() {
    setMenuOpen(false);
    window.setTimeout(() => menuButtonRef.current?.focus(), 0);
  }

  const guideHref =
    activeScreen && !pathname.startsWith("/guide")
      ? `/guide/${activeScreen.guideSlug}?returnTo=${encodeURIComponent(
          `${pathname}${searchParams.size > 0 ? `?${searchParams.toString()}` : ""}`,
        )}`
      : undefined;

  return (
    <div className={`app-shell app-shell--${actor.role}`}>
      <aside className="app-sidebar">
        <Link className="app-brand" href="/">
          KINMU-OS
        </Link>
        <NavigationTree
          label="メインメニュー"
          pathname={pathname}
          role={actor.role}
          unreadCount={unreadCount}
        />
      </aside>
      <header className="app-topbar">
        <Link className="app-mobile-brand" href="/">
          KINMU-OS
        </Link>
        <div className="app-topbar__actions">
          <Link
            aria-label={unreadCount > 0 ? `通知、${unreadCount}件の未読があります` : "通知を確認"}
            className="app-icon-button"
            href="/notifications"
          >
            <BellIcon />
            {unreadCount > 0 ? (
              <span aria-hidden="true" className="notification-badge notification-badge--floating">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            ) : null}
          </Link>
          <div className="app-user">
            <UserIcon />
            <span>{actor.displayName}</span>
          </div>
          <LogoutButton />
        </div>
      </header>
      <div className="app-content">
        {activeScreen ? (
          <div className="app-route-context">
            <div className="app-route-context__orientation">
              <nav aria-label="現在地" className="app-breadcrumb">
                {activeScreen.area !== activeScreen.title ? (
                  <>
                    <span>{activeScreen.area}</span>
                    <ChevronRightIcon />
                  </>
                ) : null}
                <span aria-current="page">{activeScreen.title}</span>
              </nav>
              <p>{activeScreen.purpose}</p>
            </div>
            {guideHref ? (
              <Link className="app-context-help" href={guideHref}>
                <HelpIcon />
                この画面の使い方
              </Link>
            ) : null}
          </div>
        ) : null}
        {children}
      </div>
      <Navigation label="モバイルメニュー">
        <ul className="app-bottom-nav">
          {mobileItems.map((item) => {
            const ItemIcon = iconByKey[item.icon];
            return (
              <li key={item.id}>
                <Link
                  aria-current={item.id === activeItemId ? "page" : undefined}
                  href={item.href}
                  prefetch={false}
                >
                  <ItemIcon />
                  <span>{item.label}</span>
                  {item.id === "notifications" && unreadCount > 0 ? (
                    <span aria-label={`${unreadCount}件の未読通知`} className="notification-badge">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              aria-current={!currentIsInMobile ? "page" : undefined}
              aria-expanded={menuOpen}
              className="app-bottom-nav__button"
              onClick={() => setMenuOpen(true)}
              ref={menuButtonRef}
              type="button"
            >
              <MenuIcon />
              <span>すべて</span>
            </button>
          </li>
        </ul>
      </Navigation>
      <Drawer
        closeButtonRef={closeButtonRef}
        onClose={closeMenu}
        open={menuOpen}
        pathname={pathname}
        role={actor.role}
        unreadCount={unreadCount}
      />
    </div>
  );
}

export function AppShell({ actor, children }: { actor: ShellActor; children: ReactNode }) {
  return (
    <UnsavedChangesProvider>
      <AppShellLayout actor={actor}>{children}</AppShellLayout>
    </UnsavedChangesProvider>
  );
}
