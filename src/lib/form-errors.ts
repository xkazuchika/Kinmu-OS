export type FormErrorKind = "conflict" | "field" | "forbidden" | "server" | "state";

export type FormErrorPresentation = Readonly<{
  fieldErrors: readonly Readonly<{ fieldId: string; message: string }>[];
  kind: FormErrorKind;
  message: string;
  retry: string;
}>;

const safeFallback = "処理を完了できませんでした。";

export function formErrorFromResponse(
  status: number,
  payload: Readonly<{ error?: unknown; fieldErrors?: unknown }>,
): FormErrorPresentation {
  const message =
    typeof payload.error === "string" && payload.error.trim() ? payload.error : safeFallback;
  const fieldErrors =
    payload.fieldErrors &&
    typeof payload.fieldErrors === "object" &&
    !Array.isArray(payload.fieldErrors)
      ? Object.entries(payload.fieldErrors).flatMap(([fieldId, value]) =>
          typeof value === "string" && value.trim() ? [{ fieldId, message: value }] : [],
        )
      : [];

  if (fieldErrors.length > 0 || status === 400 || status === 422) {
    return {
      fieldErrors,
      kind: "field",
      message,
      retry: "入力内容を修正し、もう一度保存してください。",
    };
  }
  if (status === 409) {
    return {
      fieldErrors: [],
      kind: "conflict",
      message,
      retry: "最新の状態を読み込み、変更内容を確認してからやり直してください。",
    };
  }
  if (status === 401 || status === 403) {
    return {
      fieldErrors: [],
      kind: "forbidden",
      message: "この操作を続ける権限または有効なログイン状態を確認できませんでした。",
      retry: "画面を再読み込みし、必要なら管理者へ権限を確認してください。",
    };
  }
  if (status >= 500) {
    return {
      fieldErrors: [],
      kind: "server",
      message: safeFallback,
      retry: "入力内容は残っています。時間を置いてからもう一度お試しください。",
    };
  }
  return {
    fieldErrors: [],
    kind: "state",
    message,
    retry: "画面の状態を確認してから、もう一度お試しください。",
  };
}
