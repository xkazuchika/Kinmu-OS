import type { ReactNode } from "react";

import { ClockIcon, PeopleIcon, ShieldIcon } from "@/components/icons";

const benefits = [
  { icon: ClockIcon, label: "出退勤・休憩・残業を一画面で" },
  { icon: PeopleIcon, label: "従業員情報を必要十分に管理" },
  { icon: ShieldIcon, label: "大切なデータは自社環境に保管" },
];

export function AuthShell({
  children,
  description,
  eyebrow,
  title,
}: {
  children: ReactNode;
  description: string;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="auth-shell">
      <section aria-label="Kinmu-OSについて" className="auth-story">
        <div className="auth-brand">
          <span aria-hidden="true" className="auth-brand__mark">
            K
          </span>
          <span>KINMU-OS</span>
        </div>

        <div className="auth-story__content">
          <p className="auth-story__headline">
            勤怠と労務を、
            <br />
            すっきりひとつに。
          </p>
          <p className="auth-story__lead">
            100名以下のチームにちょうどいい、
            <br />
            セルフホスト型の労務管理。
          </p>
          <ul className="auth-benefits">
            {benefits.map(({ icon: Icon, label }) => (
              <li key={label}>
                <span aria-hidden="true">
                  <Icon />
                </span>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="auth-story__footer">Open source · Self-hosted</p>
      </section>

      <section className="auth-content">
        <div className="auth-mobile-brand">
          <span aria-hidden="true" className="auth-brand__mark">
            K
          </span>
          <span>KINMU-OS</span>
        </div>

        <div className="auth-panel">
          <header className="auth-heading">
            <p className="auth-eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </header>
          {children}
        </div>

        <p className="auth-content__footer">Your workplace data, under your control.</p>
      </section>
    </main>
  );
}
