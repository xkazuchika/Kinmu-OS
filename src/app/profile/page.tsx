import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { ProfileEditor } from "@/components/profile-editor";
import { EmptyState, PageHeader } from "@/components/ui";
import { sessionForToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getDatabase } from "@/lib/db/client";
import { getSelfProfile } from "@/lib/employees";

export default async function ProfilePage() {
  const database = getDatabase();
  const cookieStore = await cookies();
  const actor = await sessionForToken(database, cookieStore.get(SESSION_COOKIE_NAME)?.value);

  if (!actor) redirect("/login");
  const profile = await getSelfProfile(database, actor);

  if (!profile) {
    return (
      <main className="profile-page">
        <PageHeader title="プロフィール">自分の登録情報を確認します。</PageHeader>
        <EmptyState title="従業員情報が紐付いていません">
          労務管理者に、利用者と従業員台帳の紐付けを依頼してください。
        </EmptyState>
      </main>
    );
  }

  return <ProfileEditor profile={profile} />;
}
