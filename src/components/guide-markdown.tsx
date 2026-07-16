import Link from "next/link";
import type { ReactNode } from "react";

import type { GuideBlock, GuideInline } from "@/lib/user-guide";

function InlineContent({ inlines }: { inlines: readonly GuideInline[] }) {
  return inlines.map((inline, index) => {
    const key = `${inline.kind}-${index}`;
    if (inline.kind === "code") return <code key={key}>{inline.value}</code>;
    if (inline.kind === "link")
      return (
        <Link href={inline.href} key={key}>
          {inline.label}
        </Link>
      );
    return <span key={key}>{inline.value}</span>;
  });
}

export function GuideMarkdown({ blocks }: { blocks: readonly GuideBlock[] }) {
  return (
    <div className="guide-prose">
      {blocks.map((block, index): ReactNode => {
        const key = `${block.kind}-${index}`;
        if (block.kind === "heading") {
          const content = <InlineContent inlines={block.inlines} />;
          if (block.level === 1) return <h1 key={key}>{content}</h1>;
          if (block.level === 2) return <h2 key={key}>{content}</h2>;
          return <h3 key={key}>{content}</h3>;
        }
        if (block.kind === "paragraph")
          return (
            <p key={key}>
              <InlineContent inlines={block.inlines} />
            </p>
          );
        if (block.kind === "code")
          return (
            <pre key={key}>
              <code>{block.value}</code>
            </pre>
          );
        const List = block.ordered ? "ol" : "ul";
        return (
          <List key={key}>
            {block.items.map((item, itemIndex) => (
              <li key={`${key}-${itemIndex}`}>
                <InlineContent inlines={item} />
              </li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
