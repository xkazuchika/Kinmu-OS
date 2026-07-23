export class PayrollResourceNotFoundError extends Error {
  constructor() {
    super("指定された給与連携リソースが見つかりません。");
    this.name = "PayrollResourceNotFoundError";
  }
}
