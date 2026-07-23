import { z } from "zod";

import {
  listPayrollEmployeeMappings,
  savePayrollEmployeeMapping,
} from "@/lib/payroll-employee-mappings";
import { payrollErrorResponse, payrollRequestContext } from "@/lib/payroll-http";

type RouteContext = { params: Promise<{ profileId: string }> };
const mappingSchema = z
  .object({
    employeeId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    externalEmployeeCode: z.string().nullable(),
  })
  .strict();

export async function GET(request: Request, context: RouteContext) {
  try {
    const { actor, database } = await payrollRequestContext(request);
    const { profileId } = await context.params;
    return Response.json({
      mappings: await listPayrollEmployeeMappings(database, actor, profileId),
    });
  } catch (error) {
    return payrollErrorResponse(error, "外部従業員コードを取得できませんでした。");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const body = mappingSchema.parse(await request.json());
    const { actor, database } = await payrollRequestContext(request);
    const { profileId } = await context.params;
    return Response.json({
      mapping: await savePayrollEmployeeMapping(database, actor, { ...body, profileId }),
    });
  } catch (error) {
    return payrollErrorResponse(error, "外部従業員コードを更新できませんでした。");
  }
}
