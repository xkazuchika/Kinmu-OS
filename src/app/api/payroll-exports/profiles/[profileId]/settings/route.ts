import { exportPayrollProfileSettings } from "@/lib/payroll-export-profiles";
import { payrollErrorResponse, payrollRequestContext } from "@/lib/payroll-http";

type RouteContext = { params: Promise<{ profileId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { actor, database } = await payrollRequestContext(request);
    const { profileId } = await context.params;
    const settings = await exportPayrollProfileSettings(database, actor, profileId);
    return Response.json(settings, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": "attachment; filename=payroll-profile.json",
      },
    });
  } catch (error) {
    return payrollErrorResponse(error, "給与連携設定を移出できませんでした。");
  }
}
