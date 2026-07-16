import { cookies } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { GuideMarkdown } from "@/components/guide-markdown";
import { sessionForToken, SESSION_COOKIE_NAME } from "@/lib/auth";
import { getDatabase } from "@/lib/db/client";
import { loadEnvironment } from "@/lib/env";
import {
  GuideContentError,
  guideForSlug,
  guidesForRole,
  parseGuideMarkdown,
  readGuide,
  roleLabel,
} from "@/lib/user-guide";

export default async function GuideArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = guideForSlug(slug);
  if (!guide) notFound();

  const cookieStore = await cookies();
  const actor = await sessionForToken(getDatabase(), cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!actor) redirect("/login");

  const ordered = guidesForRole(actor.role);
  const position = ordered.findIndex((entry) => entry.slug === guide.slug);
  const previous = position > 0 ? ordered[position - 1] : undefined;
  const next = position < ordered.length - 1 ? ordered[position + 1] : undefined;

  let blocks;
  try {
    blocks = parseGuideMarkdown(await readGuide(guide));
  } catch (error) {
    if (!(error instanceof GuideContentError)) throw error;
    const sourceUrl = new URL("docs/user-guide/", loadEnvironment().sourceCodeUrl).toString();
    return (
      <main className="guide-article-page">
        <nav aria-label="現在地" className="guide-breadcrumb">
          <Link href="/guide">利用ガイド</Link>
          <span aria-hidden="true">/</span>
          <span>{guide.title}</span>
        </nav>
        <section className="guide-load-error" role="alert">
          <h1>利用ガイドを読み込めませんでした</h1>
          <p>配布物にガイド本文が含まれているか、運営者に確認してください。</p>
          <a href={sourceUrl} rel="noreferrer" target="_blank">
            公開リポジトリのガイドを確認する
          </a>
        </section>
      </main>
    );
  }

  return (
    <main className="guide-article-page">
      <nav aria-label="現在地" className="guide-breadcrumb">
        <Link href="/guide">利用ガイド</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{guide.title}</span>
      </nav>
      <div
        aria-label={`対象役割: ${guide.roles.map(roleLabel).join("、")}`}
        className="guide-article-roles"
      >
        <span>対象役割</span>
        <strong>{guide.roles.map(roleLabel).join("・")}</strong>
      </div>
      <article>
        <GuideMarkdown blocks={blocks} />
      </article>
      <nav aria-label="前後の記事" className="guide-pagination">
        {previous ? (
          <Link href={`/guide/${previous.slug}`}>
            <small>前の記事</small>
            <span>{previous.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next ? (
          <Link href={`/guide/${next.slug}`}>
            <small>次の記事</small>
            <span>{next.title}</span>
          </Link>
        ) : (
          <span />
        )}
      </nav>
      <Link className="guide-back-link" href="/guide">
        ガイド一覧へ戻る
      </Link>
    </main>
  );
}
