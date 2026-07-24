import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  AsyncButton,
  AsyncStatus,
  Disclosure,
  Field,
  FormErrorSummary,
  ListHeader,
  PageHeader,
  Pagination,
  StatePanel,
  SubjectContext,
  Table,
  TaskContext,
  TextareaField,
} from "@/components/ui";

describe("business UI primitives", () => {
  it("renders a page purpose, context, status, actions, and guide without changing heading order", () => {
    const html = renderToStaticMarkup(
      <PageHeader
        actions={<button type="button">従業員を登録</button>}
        context={<span>2026年7月</span>}
        guide={<Link href="/guide/admin-setup">使い方</Link>}
        status={<span>設定中</span>}
        title="従業員"
      >
        在籍する従業員を登録します。
      </PageHeader>,
    );

    expect(html).toContain("<h1>従業員</h1>");
    expect(html).toContain("在籍する従業員を登録します。");
    expect(html).toContain("2026年7月");
    expect(html).toContain("設定中");
    expect(html).toContain("使い方");
  });

  it("associates guidance, units, and errors with one input", () => {
    const html = renderToStaticMarkup(
      <Field
        constraint="1分以上、1,440分以下"
        description="1日の所定労働時間です。"
        error="所定労働時間を入力してください。"
        example="480"
        fieldSize="short"
        id="scheduled-minutes"
        label="所定労働時間"
        required
        unit="分"
      />,
    );

    expect(html).toContain('aria-describedby="scheduled-minutes-guidance scheduled-minutes-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain("必須");
    expect(html).toContain("480");
    expect(html).toContain("分");
  });

  it("sizes common business values by their expected content", () => {
    const html = renderToStaticMarkup(
      <form>
        <Field id="employee-number" label="従業員番号" />
        <Field id="person-name" label="氏名" />
        <Field id="contact-email" label="メール" optional type="email" />
        <Field id="effective-date" label="適用日" type="date" />
        <Field id="minutes" label="分数" type="number" unit="分" />
        <TextareaField constraint="1,000文字以内" id="reason" label="理由" required rows={4} />
      </form>,
    );

    expect(html).toContain("ui-field--medium");
    expect(html).toContain("ui-field--long");
    expect(html).toContain("ui-field--short");
    expect(html).toContain("任意");
    expect(html).toContain('rows="4"');
  });

  it("exposes task, state, subject, and asynchronous status semantics", () => {
    const html = renderToStaticMarkup(
      <>
        <TaskContext
          blockers={["勤務ルールが未設定です"]}
          completion="対象月を締められる状態にします。"
          prerequisites={["対象月を選択してください"]}
        />
        <StatePanel kind="blocked" title="締めを開始できません">
          未退勤を解消してください。
        </StatePanel>
        <SubjectContext items={[{ label: "対象月", value: "2026年7月" }]} />
        <AsyncStatus pending>保存しています</AsyncStatus>
        <AsyncButton pending pendingLabel="登録しています">
          登録する
        </AsyncButton>
      </>,
    );

    expect(html).toContain("完了の目安");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("登録しています");
    expect(html).toContain("disabled");
    expect(html).toContain("<dt>対象月</dt>");
  });

  it("uses native disclosure and accessible list and error summaries", () => {
    const html = renderToStaticMarkup(
      <>
        <Disclosure summary="詳細設定">追加条件</Disclosure>
        <ListHeader filteredCount={3} totalCount={10}>
          審査待ち
        </ListHeader>
        <FormErrorSummary errors={[{ fieldId: "name", message: "氏名を入力してください。" }]} />
      </>,
    );

    expect(html).toContain("<details");
    expect(html).toContain("<summary>詳細設定</summary>");
    expect(html).toContain("10件中 3件を表示");
    expect(html).toContain('href="#name"');
    expect(html).toContain('tabindex="-1"');
  });

  it("keeps a 100-row responsive list labelled for desktop and mobile", () => {
    const html = renderToStaticMarkup(
      <Table label="従業員100名" responsive>
        <thead>
          <tr>
            <th>従業員番号</th>
            <th>氏名</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: 100 }, (_, index) => (
            <tr key={index}>
              <td data-label="従業員番号">{String(index + 1).padStart(3, "0")}</td>
              <td data-label="氏名">長い氏名を含むテスト従業員 {index + 1}</td>
            </tr>
          ))}
        </tbody>
      </Table>,
    );

    expect(html).toContain("ui-table-scroll--responsive");
    expect(html).toContain("<caption");
    expect((html.match(/data-label="従業員番号"/g) ?? []).length).toBe(100);
  });

  it("labels paging controls and disables unavailable directions", () => {
    const html = renderToStaticMarkup(
      <Pagination currentPage={1} onPageChange={() => undefined} totalPages={3} />,
    );
    expect(html).toContain('aria-label="ページを移動"');
    expect(html).toContain("1 / 3ページ");
    expect(html).toMatch(/disabled=""[^>]*>前のページ/);
    expect(html).toContain(">次のページ</button>");
  });
});
