import { z } from "zod";

import {
  importPayrollProfileSettings,
  previewPayrollProfileImport,
} from "@/lib/payroll-export-profiles";
import { payrollErrorResponse, payrollRequestContext } from "@/lib/payroll-http";

const importSchema = z
  .object({ mode: z.enum(["preview", "commit"]), settings: z.unknown() })
  .strict();

export async function POST(request: Request) {
  try {
    const body = importSchema.parse(await request.json());
    const { actor, database } = await payrollRequestContext(request);
    if (body.mode === "preview")
      return Response.json({ preview: previewPayrollProfileImport(body.settings) });
    const profile = await importPayrollProfileSettings(database, actor, body.settings);
    return Response.json({ profile }, { status: 201 });
  } catch (error) {
    return payrollErrorResponse(error, "給与連携設定を取り込めませんでした。");
  }
}
