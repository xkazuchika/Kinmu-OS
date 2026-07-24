"use client";

import type {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  Ref,
  RefObject,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { useEffect, useLayoutEffect, useRef } from "react";

function classes(...values: Array<string | undefined>) {
  return values.filter(Boolean).join(" ");
}

export type FieldSize = "full" | "long" | "medium" | "short";

type FieldGuidance = {
  constraint?: string;
  description?: string;
  example?: string;
  fieldSize?: FieldSize;
  impact?: string;
  optional?: boolean;
  unit?: string;
};

function describedBy(...ids: Array<string | undefined>) {
  const value = ids.filter(Boolean).join(" ");
  return value || undefined;
}

function FieldLabel({
  label,
  optional,
  required,
}: {
  label: string;
  optional?: boolean;
  required?: boolean;
}) {
  return (
    <span className="ui-field__label">
      <span>{label}</span>
      {required ? <span className="ui-field__requirement">必須</span> : null}
      {!required && optional ? <span className="ui-field__optional">任意</span> : null}
    </span>
  );
}

function FieldGuidanceText({
  constraint,
  description,
  example,
  id,
  impact,
}: Pick<FieldGuidance, "constraint" | "description" | "example" | "impact"> & { id: string }) {
  if (!description && !example && !constraint && !impact) return null;
  return (
    <span className="ui-field__guidance" id={id}>
      {description ? <span>{description}</span> : null}
      {example ? <span>例: {example}</span> : null}
      {constraint ? <span>{constraint}</span> : null}
      {impact ? <span className="ui-field__impact">{impact}</span> : null}
    </span>
  );
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

export function PageHeader({
  actions,
  children,
  context,
  guide,
  status,
  title,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  context?: ReactNode;
  guide?: ReactNode;
  status?: ReactNode;
  title: string;
}) {
  return (
    <header className="ui-page-header">
      <div className="ui-page-header__main">
        <div className="ui-page-header__copy">
          <h1>{title}</h1>
          {children ? <p>{children}</p> : null}
        </div>
        {actions ? <div className="ui-page-header__actions">{actions}</div> : null}
      </div>
      {context || status || guide ? (
        <div className="ui-page-header__meta">
          {context ? <div className="ui-page-header__context">{context}</div> : null}
          {status ? <div className="ui-page-header__status">{status}</div> : null}
          {guide ? <div className="ui-page-header__guide">{guide}</div> : null}
        </div>
      ) : null}
    </header>
  );
}

export function Field({
  constraint,
  description,
  error,
  example,
  fieldSize,
  id,
  impact,
  label,
  optional,
  unit,
  ...props
}: InputHTMLAttributes<HTMLInputElement> &
  FieldGuidance & { error?: string; id: string; label: string }) {
  const resolvedFieldSize =
    fieldSize ??
    (props.type === "date" ||
    props.type === "month" ||
    props.type === "number" ||
    props.type === "time"
      ? "short"
      : props.type === "email" || props.type === "search"
        ? "long"
        : "medium");
  const errorId = error ? `${id}-error` : undefined;
  const guidanceId = description || example || constraint || impact ? `${id}-guidance` : undefined;
  const externalDescription = props["aria-describedby"];

  return (
    <label className={classes("ui-field", `ui-field--${resolvedFieldSize}`)} htmlFor={id}>
      <FieldLabel label={label} optional={optional} required={props.required} />
      <span className="ui-field__control">
        <input
          {...props}
          aria-describedby={describedBy(externalDescription, guidanceId, errorId)}
          aria-invalid={Boolean(error)}
          id={id}
        />
        {unit ? <span className="ui-field__unit">{unit}</span> : null}
      </span>
      {guidanceId ? (
        <FieldGuidanceText
          constraint={constraint}
          description={description}
          example={example}
          id={guidanceId}
          impact={impact}
        />
      ) : null}
      {error ? (
        <small className="ui-field__error" id={errorId} role="alert">
          {error}
        </small>
      ) : null}
    </label>
  );
}

export function SelectField({
  children,
  constraint,
  description,
  error,
  example,
  fieldSize = "medium",
  id,
  impact,
  label,
  optional,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & {
  children: ReactNode;
  constraint?: string;
  description?: string;
  error?: string;
  example?: string;
  fieldSize?: FieldSize;
  label: string;
  impact?: string;
  optional?: boolean;
}) {
  const errorId = error ? `${id}-error` : undefined;
  const guidanceId = description || example || constraint || impact ? `${id}-guidance` : undefined;
  const externalDescription = props["aria-describedby"];

  return (
    <label className={classes("ui-field", `ui-field--${fieldSize}`)} htmlFor={id}>
      <FieldLabel label={label} optional={optional} required={props.required} />
      <select
        {...props}
        aria-describedby={describedBy(externalDescription, guidanceId, errorId)}
        aria-invalid={Boolean(error)}
        id={id}
      >
        {children}
      </select>
      {guidanceId ? (
        <FieldGuidanceText
          constraint={constraint}
          description={description}
          example={example}
          id={guidanceId}
          impact={impact}
        />
      ) : null}
      {error ? (
        <small className="ui-field__error" id={errorId} role="alert">
          {error}
        </small>
      ) : null}
    </label>
  );
}

export function TextareaField({
  constraint,
  description,
  error,
  example,
  fieldSize = "long",
  id,
  impact,
  label,
  optional,
  rows = 5,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement> &
  FieldGuidance & { error?: string; id: string; label: string }) {
  const errorId = error ? `${id}-error` : undefined;
  const guidanceId = description || example || constraint || impact ? `${id}-guidance` : undefined;
  const externalDescription = props["aria-describedby"];
  return (
    <label className={classes("ui-field", `ui-field--${fieldSize}`)} htmlFor={id}>
      <FieldLabel label={label} optional={optional} required={props.required} />
      <textarea
        {...props}
        aria-describedby={describedBy(externalDescription, guidanceId, errorId)}
        aria-invalid={Boolean(error)}
        id={id}
        rows={rows}
      />
      {guidanceId ? (
        <FieldGuidanceText
          constraint={constraint}
          description={description}
          example={example}
          id={guidanceId}
          impact={impact}
        />
      ) : null}
      {error ? (
        <small className="ui-field__error" id={errorId} role="alert">
          {error}
        </small>
      ) : null}
    </label>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="ui-filter-bar">{children}</div>;
}

export function Table({
  children,
  label,
  responsive = false,
  stickyHeader = true,
}: {
  children: ReactNode;
  label: string;
  responsive?: boolean;
  stickyHeader?: boolean;
}) {
  return (
    <div
      className={classes(
        "ui-table-scroll",
        stickyHeader ? "ui-table-scroll--sticky" : undefined,
        responsive ? "ui-table-scroll--responsive" : undefined,
      )}
    >
      <table className="ui-table">
        <caption className="sr-only">{label}</caption>
        {children}
      </table>
    </div>
  );
}

function adjacentMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function MonthNavigation({
  month,
  onChange,
}: {
  month: string;
  onChange: (month: string) => void;
}) {
  const label = /^\d{4}-\d{2}$/.test(month)
    ? `${Number(month.slice(0, 4))}年${Number(month.slice(5, 7))}月`
    : month;
  return (
    <nav aria-label="前月・翌月へ移動" className="ui-month-navigation">
      <Button
        aria-label={`${label}の前月を表示`}
        onClick={() => onChange(adjacentMonth(month, -1))}
        type="button"
        variant="text"
      >
        ← 前月
      </Button>
      <strong aria-live="polite">{label}</strong>
      <Button
        aria-label={`${label}の翌月を表示`}
        onClick={() => onChange(adjacentMonth(month, 1))}
        type="button"
        variant="text"
      >
        翌月 →
      </Button>
    </nav>
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

export function StatePanel({
  action,
  children,
  kind,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  kind:
    | "blocked"
    | "closed"
    | "error"
    | "forbidden"
    | "noRecords"
    | "noSearchResults"
    | "notConfigured";
  title: string;
}) {
  return (
    <section
      className={`ui-state-panel ui-state-panel--${kind}`}
      role={kind === "error" ? "alert" : "status"}
    >
      <div>
        <h2>{title}</h2>
        <div className="ui-state-panel__body">{children}</div>
      </div>
      {action ? <div className="ui-state-panel__action">{action}</div> : null}
    </section>
  );
}

export function TaskContext({
  blockers = [],
  completion,
  prerequisites = [],
}: {
  blockers?: readonly string[];
  completion: string;
  prerequisites?: readonly string[];
}) {
  return (
    <section className="ui-task-context" aria-label="この画面で完了すること">
      <div>
        <h2>完了の目安</h2>
        <p>{completion}</p>
      </div>
      {prerequisites.length > 0 ? (
        <div>
          <h3>開始前に確認</h3>
          <ul>
            {prerequisites.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {blockers.length > 0 ? (
        <div className="ui-task-context__blockers">
          <h3>現在の阻害要因</h3>
          <ul>
            {blockers.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

export function PrimaryActionGroup({
  children,
  destructive,
  secondary,
}: {
  children: ReactNode;
  destructive?: ReactNode;
  secondary?: ReactNode;
}) {
  return (
    <div className="ui-primary-actions">
      <div className="ui-primary-actions__main">{children}</div>
      {secondary ? <div className="ui-primary-actions__secondary">{secondary}</div> : null}
      {destructive ? <div className="ui-primary-actions__danger">{destructive}</div> : null}
    </div>
  );
}

export function ResultSummary({
  action,
  children,
  title,
}: {
  action?: ReactNode;
  children: ReactNode;
  title: string;
}) {
  return (
    <section className="ui-result-summary" role="status">
      <div>
        <h2>{title}</h2>
        <div>{children}</div>
      </div>
      {action ? <div>{action}</div> : null}
    </section>
  );
}

export function SubjectContext({
  items,
}: {
  items: readonly Readonly<{ label: string; value: ReactNode }>[];
}) {
  return (
    <dl className="ui-subject-context">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Disclosure({
  children,
  defaultOpen = false,
  summary,
}: {
  children: ReactNode;
  defaultOpen?: boolean;
  summary: string;
}) {
  return (
    <details className="ui-disclosure" open={defaultOpen || undefined}>
      <summary>{summary}</summary>
      <div className="ui-disclosure__body">{children}</div>
    </details>
  );
}

export function ListHeader({
  actions,
  children,
  filteredCount,
  totalCount,
}: {
  actions?: ReactNode;
  children?: ReactNode;
  filteredCount: number;
  totalCount: number;
}) {
  return (
    <div className="ui-list-header">
      <div>
        <strong>
          {totalCount}件中 {filteredCount}件を表示
        </strong>
        {children ? <div className="ui-list-header__filters">{children}</div> : null}
      </div>
      {actions ? <div className="ui-list-header__actions">{actions}</div> : null}
    </div>
  );
}

export function FilterChip({ children, onRemove }: { children: ReactNode; onRemove?: () => void }) {
  return (
    <span className="ui-filter-chip">
      {children}
      {onRemove ? (
        <button aria-label={`${String(children)}の条件を解除`} onClick={onRemove} type="button">
          ×
        </button>
      ) : null}
    </span>
  );
}

export function BulkActionBar({
  actions,
  children,
  selectedCount,
}: {
  actions: ReactNode;
  children?: ReactNode;
  selectedCount: number;
}) {
  return (
    <div className="ui-bulk-actions" role="status">
      <div>
        <strong>{selectedCount}件を選択中</strong>
        {children ? <span>{children}</span> : null}
      </div>
      <div>{actions}</div>
    </div>
  );
}

export function Pagination({
  currentPage,
  onPageChange,
  totalPages,
}: {
  currentPage: number;
  onPageChange: (page: number) => void;
  totalPages: number;
}) {
  return (
    <nav aria-label="ページを移動" className="ui-pagination">
      <Button
        disabled={currentPage <= 1}
        onClick={() => onPageChange(currentPage - 1)}
        type="button"
        variant="secondary"
      >
        前のページ
      </Button>
      <span aria-live="polite">
        {currentPage} / {totalPages}ページ
      </span>
      <Button
        disabled={currentPage >= totalPages}
        onClick={() => onPageChange(currentPage + 1)}
        type="button"
        variant="secondary"
      >
        次のページ
      </Button>
    </nav>
  );
}

export function FormErrorSummary({
  autoFocus = true,
  errors,
  title = "入力内容を確認してください",
}: {
  autoFocus?: boolean;
  errors: readonly Readonly<{ fieldId: string; message: string }>[];
  title?: string;
}) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const errorKey = errors.map((error) => `${error.fieldId}:${error.message}`).join("|");
  const firstFieldId = errors[0]?.fieldId;
  const previousErrorKeyRef = useRef("");

  useEffect(() => {
    if (autoFocus && errorKey && errorKey !== previousErrorKeyRef.current) {
      const firstField = document.getElementById(firstFieldId ?? "");
      if (firstField instanceof HTMLElement) firstField.focus();
      else summaryRef.current?.focus();
    }
    previousErrorKeyRef.current = errorKey;
  }, [autoFocus, errorKey, firstFieldId]);

  if (errors.length === 0) return null;
  return (
    <div className="ui-form-errors" ref={summaryRef} role="alert" tabIndex={-1}>
      <strong>{title}</strong>
      <ul>
        {errors.map((error) => (
          <li key={`${error.fieldId}-${error.message}`}>
            <a href={`#${error.fieldId}`}>{error.message}</a>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AsyncStatus({ children, pending }: { children: ReactNode; pending: boolean }) {
  return (
    <span aria-busy={pending} aria-live="polite" className="ui-async-status" role="status">
      {pending ? <span className="ui-spinner" /> : null}
      {children}
    </span>
  );
}

export function AsyncButton({
  children,
  pending,
  pendingLabel,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  pending: boolean;
  pendingLabel: string;
  ref?: Ref<HTMLButtonElement>;
}) {
  return (
    <Button {...props} aria-busy={pending} disabled={pending || props.disabled}>
      {pending ? (
        <span className="ui-async-status">
          <span aria-hidden="true" className="ui-spinner" />
          <span>{pendingLabel}</span>
        </span>
      ) : (
        children
      )}
    </Button>
  );
}

export function DisabledReason({ children }: { children: ReactNode }) {
  return <p className="ui-disabled-reason">{children}</p>;
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
  confirmDisabled = false,
  confirmLabel,
  onCancel,
  onConfirm,
  open,
  returnFocusRef,
  title,
}: {
  children: ReactNode;
  confirmDisabled?: boolean;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  title: string;
}) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);

  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useLayoutEffect(() => {
    if (!open) {
      return;
    }

    const previouslyFocused =
      returnFocusRef?.current ?? (document.activeElement as HTMLElement | null);
    cancelButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancelRef.current();
        return;
      }

      if (event.key === "Tab") {
        const dialog = cancelButtonRef.current?.closest('[role="alertdialog"]');
        const controls = Array.from(
          dialog?.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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

    return () => {
      document.removeEventListener("keydown", closeOnEscape);
      previouslyFocused?.focus();
    };
  }, [open, returnFocusRef]);

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
        <div className="ui-dialog__body">{children}</div>
        <div className="ui-dialog__actions">
          <Button ref={cancelButtonRef} onClick={onCancel} type="button" variant="secondary">
            キャンセル
          </Button>
          <Button disabled={confirmDisabled} onClick={onConfirm} type="button" variant="danger">
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
