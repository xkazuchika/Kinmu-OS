import { z } from "zod";

import {
  commitPayrollMappingCsv,
  payrollMappingCsvTemplate,
  previewPayrollMappingCsv,
} from "@/lib/payroll-employee-mappings";
import { payrollErrorResponse, payrollRequestContext } from "@/lib/payroll-http";

type RouteContext = { params: Promise<{ profileId: string }> };
const csvSchema = z
  .object({ mode: z.enum(["preview", "commit"]), csv: z.string().max(262_144) })
  .strict();

export async function GET(request: Request) {
  try {
    await payrollRequestContext(request);
    return new Response(payrollMappingCsvTemplate(), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": "attachment; filename=payroll-employee-mappings.csv",
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return payrollErrorResponse(error, "コード対応テンプレートを取得できませんでした。");
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const body = csvSchema.parse(await request.json());
    const { actor, database } = await payrollRequestContext(request);
    const { profileId } = await context.params;
    if (body.mode === "preview") {
      return Response.json({
        preview: await previewPayrollMappingCsv(database, actor, { csv: body.csv, profileId }),
      });
    }
    return Response.json({
      count: await commitPayrollMappingCsv(database, actor, { csv: body.csv, profileId }),
    });
  } catch (error) {
    return payrollErrorResponse(error, "コード対応CSVを処理できませんでした。");
  }
}
