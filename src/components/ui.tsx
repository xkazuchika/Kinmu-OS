"use client";

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  Ref,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useEffect, useRef } from "react";

function classes(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function Button({
  className,
  ref,
  variant = "primary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  ref?: Ref<HTMLButtonElement>;
  variant?: "danger" | "primary" | "secondary" | "text";
}) {
  return (
    <button
      className={classes("ui-button", `ui-button--${variant}`, className)}
      ref={ref}
      {...props}
    />
  );
}

export function PageHeader({ children, title }: { children?: ReactNode; title: string }) {
  return (
    <header className="ui-page-header">
      <h1>{title}</h1>
      {children ? <p>{children}</p> : null}
    </header>
  );
}

export function Field({
  error,
  id,
  label,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { error?: string; label: string }) {
  const errorId = error ? `${id}-error` : undefined;

  return (
    <label className="ui-field" htmlFor={id}>
      <span>{label}</span>
      <input aria-describedby={errorId} aria-invalid={Boolean(error)} id={id} {...props} />
      {error ? (
        <small id={errorId} role="alert">
          {error}
        </small>
      ) : null}
    </label>
  );
}

export function SelectField({
  children,
  error,
  id,
  label,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  children: ReactNode;
  error?: string;
  label: string;
}) {
  const errorId = error ? `${id}-error` : undefined;

  return (
    <label className="ui-field" htmlFor={id}>
      <span>{label}</span>
      <select aria-describedby={errorId} aria-invalid={Boolean(error)} id={id} {...props}>
        {children}
      </select>
      {error ? (
        <small id={errorId} role="alert">
          {error}
        </small>
      ) : null}
    </label>
  );
}

export function TextareaField({
  error,
  id,
  label,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> & { error?: string; label: string }) {
  const errorId = error ? `${id}-error` : undefined;
  return (
    <label className="ui-field" htmlFor={id}>
      <span>{label}</span>
      <textarea aria-describedby={errorId} aria-invalid={Boolean(error)} id={id} {...props} />
      {error ? (
        <small id={errorId} role="alert">
          {error}
        </small>
      ) : null}
    </label>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="ui-filter-bar">{children}</div>;
}

export function Table({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="ui-table-scroll">
      <table className="ui-table">
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  );
}

export function EmptyState({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <div className="ui-empty-state">
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  );
}

export function Toast({
  children,
  tone = "info",
}: {
  children?: ReactNode;
  tone?: "error" | "info" | "success";
}) {
  return children ? (
    <div className={`ui-toast ui-toast--${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  ) : null;
}

export function ConfirmDialog({
  children,
  confirmLabel,
  onCancel,
  onConfirm,
  open,
  title,
}: {
  children: ReactNode;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  title: string;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    cancelButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
        return;
      }

      if (event.key === "Tab") {
        const dialog = cancelButtonRef.current?.closest('[role="alertdialog"]');
        const controls = Array.from(
          dialog?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    };
    document.addEventListener("keydown", closeOnEscape);

    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onCancel, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="ui-dialog-backdrop">
      <div
        aria-labelledby="confirmation-title"
        aria-modal="true"
        className="ui-dialog"
        role="alertdialog"
      >
        <h2 id="confirmation-title">{title}</h2>
        <p>{children}</p>
        <div className="ui-dialog__actions">
          <Button ref={cancelButtonRef} onClick={onCancel} type="button" variant="secondary">
            キャンセル
          </Button>
          <Button onClick={onConfirm} type="button" variant="danger">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function Navigation({ children, label }: { children: ReactNode; label: string }) {
  return (
    <nav aria-label={label} className="ui-navigation">
      {children}
    </nav>
  );
}
