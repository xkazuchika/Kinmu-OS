"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button, EmptyState, PageHeader, Toast } from "@/components/ui";

type Notification = {
  createdAt: string;
  id: string;
  kind: string;
  readAt: string | null;
  summary: string;
  title: string;
};
type NotificationPage = {
  items: Notification[];
  nextCursor: string | null;
  unreadCount: number;
};

async function payload(response: Response) {
  return (await response.json()) as Record<string, unknown>;
}

export default function NotificationsPage() {
  const router = useRouter();
  const [page, setPage] = useState<NotificationPage>({
    items: [],
    nextCursor: null,
    unreadCount: 0,
  });
  const [error, setError] = useState<string>();
  const [success, setSuccess] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async (before?: string) => {
    const parameters = new URLSearchParams({ limit: "30" });
    if (before) parameters.set("before", before);
    const response = await fetch(`/api/notifications?${parameters}`);
    const result = await payload(response);
    if (!response.ok) {
      setError(String(result.error ?? "通知を取得できませんでした。"));
      return;
    }
    const next = result.notifications as NotificationPage;
    setPage((current) => ({
      ...next,
      items: before ? [...current.items, ...next.items] : next.items,
    }));
    setError(undefined);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function markRead(ids: string[]) {
    if (!ids.length) return true;
    setSubmitting(true);
    const response = await fetch("/api/notifications", {
      body: JSON.stringify({ notificationIds: ids }),
      headers: { "content-type": "application/json" },
      method: "PATCH",
    });
    const result = await payload(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(result.error ?? "通知を既読にできませんでした。"));
      return false;
    }
    const readAt = new Date().toISOString();
    const changed = new Set(ids);
    setPage((current) => ({
      ...current,
      items: current.items.map((item) => (changed.has(item.id) ? { ...item, readAt } : item)),
      unreadCount: Math.max(
        0,
        current.unreadCount -
          ids.filter((id) => current.items.some((item) => item.id === id && !item.readAt)).length,
      ),
    }));
    window.dispatchEvent(new Event("kinmu:notifications-read"));
    return true;
  }

  async function openNotification(notification: Notification) {
    setSubmitting(true);
    const response = await fetch(`/api/notifications/${notification.id}`, { method: "POST" });
    const result = await payload(response);
    setSubmitting(false);
    if (!response.ok) {
      setError(String(result.error ?? "通知の対象を開けませんでした。"));
      return;
    }
    const target = result.target as { available: boolean; href: string; message: string | null };
    window.dispatchEvent(new Event("kinmu:notifications-read"));
    if (!target.available) {
      setSuccess(target.message ?? "対象を開けません。通知を既読にしました。");
      await load();
      return;
    }
    router.push(target.href);
  }

  const unreadIds = page.items.filter((item) => !item.readAt).map((item) => item.id);

  return (
    <main className="registry-page feature-page">
      <PageHeader title="通知">残業・休日出勤申請の提出、取消、審査結果を確認します。</PageHeader>
      <Toast tone="error">{error}</Toast>
      <Toast tone="success">{success}</Toast>
      <section aria-labelledby="notification-list-heading" className="feature-section">
        <div className="section-heading">
          <div>
            <h2 id="notification-list-heading">受信箱</h2>
            <p>未読 {page.unreadCount}件。対象を開く際は現在の権限を再確認します。</p>
          </div>
          <Button
            disabled={submitting || unreadIds.length === 0}
            onClick={() => void markRead(unreadIds)}
            type="button"
            variant="secondary"
          >
            表示中をすべて既読
          </Button>
        </div>
        {page.items.length === 0 ? (
          <EmptyState title="通知はありません">
            申請の状態が変わると、ここに通知されます。
          </EmptyState>
        ) : (
          <ul className="notification-list">
            {page.items.map((notification) => (
              <li className={notification.readAt ? "is-read" : "is-unread"} key={notification.id}>
                <button
                  disabled={submitting}
                  onClick={() => void openNotification(notification)}
                  type="button"
                >
                  <span
                    className="notification-state"
                    aria-label={notification.readAt ? "既読" : "未読"}
                  />
                  <span>
                    <strong>{notification.title}</strong>
                    <small>{notification.summary}</small>
                  </span>
                  <time dateTime={notification.createdAt}>
                    {new Date(notification.createdAt).toLocaleString("ja-JP")}
                  </time>
                </button>
              </li>
            ))}
          </ul>
        )}
        {page.nextCursor ? (
          <div className="pagination-action">
            <Button
              disabled={submitting}
              onClick={() => void load(page.nextCursor ?? undefined)}
              type="button"
              variant="secondary"
            >
              さらに読み込む
            </Button>
          </div>
        ) : null}
      </section>
    </main>
  );
}
