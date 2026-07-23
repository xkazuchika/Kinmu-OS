import { z } from "zod";

import { generatePayrollExportRun, listPayrollExportRuns } from "@/lib/payroll-export-runs";
import { payrollErrorResponse, payrollRequestContext } from "@/lib/payroll-http";

const generateSchema = z
  .object({
    allowOldRevision: z.boolean().optional(),
    confirmedWarningCodes: z.array(z.string().max(80)).max(100),
    expectedMappingVersions: z.record(z.uuid(), z.number().int().nonnegative()),
    expectedRevision: z.number().int().positive(),
    month: z.string().regex(/^[0-9]{4}-[0-9]{2}$/),
    profileVersionId: z.uuid(),
    revisionId: z.uuid().optional(),
    sourceRunId: z.uuid().optional(),
  })
  .strict();

export async function GET(request: Request) {
  try {
    const { actor, database } = await payrollRequestContext(request);
    const requestedMonth = new URL(request.url).searchParams.get("month") ?? undefined;
    const month = requestedMonth
      ? z
          .string()
          .regex(/^[0-9]{4}-[0-9]{2}$/)
          .parse(requestedMonth)
      : undefined;
    return Response.json({ runs: await listPayrollExportRuns(database, actor, month) });
  } catch (error) {
    return payrollErrorResponse(error, "給与連携の出力履歴を取得できませんでした。");
  }
}

export async function POST(request: Request) {
  try {
    const body = generateSchema.parse(await request.json());
    const { actor, database } = await payrollRequestContext(request);
    const result = await generatePayrollExportRun(database, actor, body);
    return new Response(new Uint8Array(result.bytes), {
      headers: { ...result.headers, "X-Kinmu-Payroll-Run-Id": result.run.id },
    });
  } catch (error) {
    return payrollErrorResponse(error, "給与連携CSVを生成できませんでした。");
  }
}
