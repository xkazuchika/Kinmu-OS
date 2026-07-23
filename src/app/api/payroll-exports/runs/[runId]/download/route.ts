import { redownloadPayrollExportRun } from "@/lib/payroll-export-runs";
import { payrollErrorResponse, payrollRequestContext } from "@/lib/payroll-http";

type RouteContext = { params: Promise<{ runId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { actor, database } = await payrollRequestContext(request);
    const { runId } = await context.params;
    const result = await redownloadPayrollExportRun(database, actor, runId);
    return new Response(new Uint8Array(result.bytes), {
      headers: { ...result.headers, "X-Kinmu-Payroll-Run-Id": result.run.id },
    });
  } catch (error) {
    return payrollErrorResponse(error, "給与連携CSVを再ダウンロードできませんでした。");
  }
}
