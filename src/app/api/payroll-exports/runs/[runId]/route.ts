import { getPayrollExportRun } from "@/lib/payroll-export-runs";
import { payrollErrorResponse, payrollRequestContext } from "@/lib/payroll-http";

type RouteContext = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { actor, database } = await payrollRequestContext(request);
    const { runId } = await context.params;
    return Response.json({ run: await getPayrollExportRun(database, actor, runId) });
  } catch (error) {
    return payrollErrorResponse(error, "給与連携の出力履歴を取得できませんでした。");
  }
}
