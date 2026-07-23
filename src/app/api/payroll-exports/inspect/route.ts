import { z } from "zod";

import { inspectPayrollExport } from "@/lib/payroll-export-runs";
import { payrollErrorResponse, payrollRequestContext } from "@/lib/payroll-http";

const inspectionSchema = z
  .object({
    month: z.string().regex(/^[0-9]{4}-[0-9]{2}$/),
    page: z.number().int().positive().optional(),
    pageSize: z.number().int().positive().max(100).optional(),
    profileVersionId: z.uuid(),
    revisionId: z.uuid().optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const body = inspectionSchema.parse(await request.json());
    const { actor, database } = await payrollRequestContext(request);
    const inspection = await inspectPayrollExport(database, actor, body);
    const { generated: _generated, sourceRows: _sourceRows, ...response } = inspection;
    return Response.json({ inspection: response });
  } catch (error) {
    return payrollErrorResponse(error, "給与連携の全件検査を実行できませんでした。");
  }
}
