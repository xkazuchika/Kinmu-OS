import { z } from "zod";

import { payrollExportFieldCatalog } from "@/lib/payroll-export-profile";
import {
  createPayrollExportProfile,
  getGenericPayrollExportDraft,
  listPayrollExportProfiles,
} from "@/lib/payroll-export-profiles";
import { payrollErrorResponse, payrollRequestContext } from "@/lib/payroll-http";

const createSchema = z
  .object({ name: z.string(), description: z.string().optional(), config: z.unknown() })
  .strict();

export async function GET(request: Request) {
  try {
    const { actor, database } = await payrollRequestContext(request);
    const [profiles, genericDraft] = await Promise.all([
      listPayrollExportProfiles(database, actor),
      getGenericPayrollExportDraft(database, actor),
    ]);
    return Response.json({ fields: payrollExportFieldCatalog(), genericDraft, profiles });
  } catch (error) {
    return payrollErrorResponse(error, "給与連携プロファイルを取得できませんでした。");
  }
}

export async function POST(request: Request) {
  try {
    const body = createSchema.parse(await request.json());
    const { actor, database } = await payrollRequestContext(request);
    const profile = await createPayrollExportProfile(database, actor, body);
    return Response.json({ profile }, { status: 201 });
  } catch (error) {
    return payrollErrorResponse(error, "給与連携プロファイルを作成できませんでした。");
  }
}
