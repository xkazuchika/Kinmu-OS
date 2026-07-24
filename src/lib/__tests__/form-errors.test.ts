import { describe, expect, it } from "vitest";

import { formErrorFromResponse } from "@/lib/form-errors";

describe("formErrorFromResponse", () => {
  it("maps safe field errors to focusable field ids", () => {
    expect(
      formErrorFromResponse(422, {
        error: "入力内容を確認してください。",
        fieldErrors: { name: "氏名を入力してください。", unsafe: 10 },
      }),
    ).toMatchObject({
      fieldErrors: [{ fieldId: "name", message: "氏名を入力してください。" }],
      kind: "field",
    });
  });

  it("explains how to recover from a conflict", () => {
    const result = formErrorFromResponse(409, { error: "更新されています。" });
    expect(result.kind).toBe("conflict");
    expect(result.retry).toContain("最新");
  });

  it("does not expose an untrusted server error", () => {
    const result = formErrorFromResponse(500, { error: "database password leaked" });
    expect(result.message).toBe("処理を完了できませんでした。");
    expect(result.retry).toContain("入力内容は残っています");
  });
});
