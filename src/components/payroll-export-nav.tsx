"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/payroll-exports", label: "出力ホーム" },
  { href: "/payroll-exports/profiles", label: "プロファイル" },
  { href: "/payroll-exports/inspect", label: "全件検査" },
  { href: "/payroll-exports/runs", label: "出力履歴" },
] as const;

export function PayrollExportNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="給与連携メニュー" className="payroll-subnav">
      {items.map((item) => {
        const current =
          item.href === "/payroll-exports"
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link aria-current={current ? "page" : undefined} href={item.href} key={item.href}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function PayrollStatus({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "danger" | "neutral" | "success" | "warning";
}) {
  return <span className={`payroll-status payroll-status--${tone}`}>{children}</span>;
}
