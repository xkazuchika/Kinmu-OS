"use client";

import Link from "next/link";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { actionKinds, actionLabels, type ActionPage } from "@/lib/action-item-types";
import { Button, Field, FilterBar, PageHeader, SelectField, StatePanel } from "@/components/ui";

export function ActionItemsPanel({ summary = false }: { summary?: boolean }) {
  const [data, setData] = useState<ActionPage>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    const parameters = summary
      ? new URLSearchParams({ summary: "true" })
      : new URLSearchParams(window.location.search);
    const timer = window.setTimeout(() => {
      setQuery(summary ? "" : parameters.toString());
      setLoading(true);
      setError("");
      void fetch(`/api/action-items?${parameters}`, {
        cache: "no-store",
        signal: controller.signal,
      })
        .then(async (response) => {
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "要対応一覧を取得できませんでした。");
          if (!controller.signal.aborted) setData(result as ActionPage);
        })
        .catch((cause: unknown) => {
          if (!controller.signal.aborted)
            setError(cause instanceof Error ? cause.message : "要対応一覧を取得できませんでした。");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [summary, version]);
  useEffect(() => {
    window.addEventListener("pageshow", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("popstate", refresh);
    return () => {
      window.removeEventListener("pageshow", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("popstate", refresh);
    };
  }, [refresh]);
  function navigate(parameters: URLSearchParams) {
    window.history.replaceState(
      null,
      "",
      `/action-items${parameters.size ? `?${parameters}` : ""}`,
    );
    setQuery(parameters.toString());
    refresh();
  }
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parameters = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget))
      if (typeof value === "string" && value) parameters.set(key, value);
    navigate(parameters);
  }
  const parameters = new URLSearchParams(query);
  const returnTo = `/action-items${query ? `?${query}` : ""}`;
  const destination = (href: string) =>
    `${href}${href.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <section className="feature-section action-center" aria-label="要対応" aria-busy={loading}>
      {summary ? (
        <div className="section-heading">
          <h2>要対応</h2>
          <Link href="/action-items">すべて確認</Link>
        </div>
      ) : (
        <PageHeader title="要対応">
          未退勤、未解決の勤務日、承認期限超過、再申請待ちを確認して対応します。
        </PageHeader>
      )}
      {loading ? (
        <p role="status">要対応を確認しています…</p>
      ) : error ? (
        <StatePanel kind="error" title="要対応を取得できませんでした">
          <p>{error}</p>
          <Button onClick={refresh} type="button">
            再取得する
          </Button>
        </StatePanel>
      ) : data ? (
        <>
          <p role="status">
            {summary ? `要対応 ${data.total}件` : `${data.total}件中 ${data.items.length}件を表示`}
            。{data.timezone}を基準に確認しています。
          </p>
          <dl className="action-counts">
            {actionKinds.map((kind) => (
              <div key={kind}>
                <dt>
                  <Link href={`/action-items?kind=${kind}`}>{actionLabels[kind]}</Link>
                </dt>
                <dd>{data.counts[kind]}件</dd>
              </div>
            ))}
          </dl>
          {!summary ? (
            <>
              <form onSubmit={filter} key={query}>
                <FilterBar>
                  <Field
                    id="action-month"
                    name="month"
                    label="対象月（空欄は全期間）"
                    type="month"
                    defaultValue={parameters.get("month") ?? ""}
                  />
                  <SelectField
                    id="action-kind"
                    name="kind"
                    label="種類"
                    defaultValue={parameters.get("kind") ?? ""}
                  >
                    <option value="">すべて</option>
                    {actionKinds.map((kind) => (
                      <option key={kind} value={kind}>
                        {actionLabels[kind]}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    id="action-employee"
                    name="employeeId"
                    label="対象者"
                    defaultValue={parameters.get("employeeId") ?? ""}
                  >
                    <option value="">すべて</option>
                    {data.employees.map((person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ))}
                  </SelectField>
                  <SelectField
                    id="action-department"
                    name="departmentId"
                    label="部署"
                    defaultValue={parameters.get("departmentId") ?? ""}
                  >
                    <option value="">すべて</option>
                    {data.departments.map((department) => (
                      <option key={department.id} value={department.id}>
                        {department.name}
                      </option>
                    ))}
                  </SelectField>
                  <Button type="submit" variant="secondary">
                    絞り込む
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => navigate(new URLSearchParams())}
                  >
                    条件を解除
                  </Button>
                </FilterBar>
              </form>
              <p className="report-note">
                承認期限超過、再申請待ち、未退勤、未解決の順に、古い期限・対象日から表示します。通知を既読にしても、業務が解消するまで残ります。
              </p>
              {data.items.length ? (
                <ul className="action-item-list">
                  {data.items.map((item) => (
                    <li key={item.id}>
                      <div>
                        <span className="action-kind">{actionLabels[item.kind]}</span>
                        <h2>{item.employeeName}</h2>
                        <p>
                          {item.date}
                          {item.departmentName ? `・${item.departmentName}` : ""}
                        </p>
                        {item.dueAt ? (
                          <p>
                            承認期限{" "}
                            {new Date(item.dueAt).toLocaleString("ja-JP", {
                              timeZone: data.timezone,
                            })}
                          </p>
                        ) : null}
                      </div>
                      <div>
                        <p>{item.reason}</p>
                        <p>
                          <strong>次の担当：</strong>
                          {item.nextOwner}
                        </p>
                        <Link
                          className="ui-button ui-button--secondary"
                          prefetch={false}
                          href={destination(item.href)}
                        >
                          {item.actionLabel}
                        </Link>
                        {item.related
                          .filter((link) => link.href !== item.href)
                          .map((link) => (
                            <p key={link.href}>
                              <Link prefetch={false} href={destination(link.href)}>
                                {link.label}
                              </Link>
                            </p>
                          ))}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <StatePanel
                  kind={data.allTotal ? "noSearchResults" : "noRecords"}
                  title={data.allTotal ? "条件に一致する要対応はありません" : "要対応はありません"}
                >
                  <p>
                    {data.allTotal
                      ? "条件を解除して他の対象を確認できます。"
                      : "現在の勤怠・申請を確認しました。"}
                  </p>
                </StatePanel>
              )}
              {data.total > data.pageSize ? (
                <nav className="form-actions" aria-label="要対応のページ">
                  <Button
                    variant="secondary"
                    disabled={data.page <= 1}
                    onClick={() => {
                      parameters.set("page", String(data.page - 1));
                      navigate(parameters);
                    }}
                  >
                    前のページ
                  </Button>
                  <span>
                    {data.page} / {Math.ceil(data.total / data.pageSize)}
                  </span>
                  <Button
                    variant="secondary"
                    disabled={data.page * data.pageSize >= data.total}
                    onClick={() => {
                      parameters.set("page", String(data.page + 1));
                      navigate(parameters);
                    }}
                  >
                    次のページ
                  </Button>
                </nav>
              ) : null}
            </>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
