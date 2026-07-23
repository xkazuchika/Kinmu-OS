import { z } from "zod";

import {
  archivePayrollExportProfile,
  createDraftFromPublishedPayrollProfile,
  duplicatePayrollExportProfile,
  getPayrollExportProfile,
  publishPayrollExportProfile,
  savePayrollExportProfileDraft,
} from "@/lib/payroll-export-profiles";
import { payrollErrorResponse, payrollRequestContext } from "@/lib/payroll-http";

type RouteContext = { params: Promise<{ profileId: string }> };
const updateSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("save"),
      config: z.unknown(),
      description: z.string().optional(),
      expectedVersion: z.number().int().nonnegative(),
      name: z.string(),
    })
    .strict(),
  z
    .object({ action: z.literal("new_draft"), expectedVersion: z.number().int().nonnegative() })
    .strict(),
  z.object({ action: z.literal("duplicate"), name: z.string() }).strict(),
  z
    .object({ action: z.literal("publish"), expectedVersion: z.number().int().nonnegative() })
    .strict(),
  z
    .object({ action: z.literal("archive"), expectedVersion: z.number().int().nonnegative() })
    .strict(),
]);

export async function GET(request: Request, context: RouteContext) {
  try {
    const { actor, database } = await payrollRequestContext(request);
    const { profileId } = await context.params;
    return Response.json({ detail: await getPayrollExportProfile(database, actor, profileId) });
  } catch (error) {
    return payrollErrorResponse(error, "給与連携プロファイルを取得できませんでした。");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const body = updateSchema.parse(await request.json());
    const { actor, database } = await payrollRequestContext(request);
    const { profileId } = await context.params;
    if (body.action === "save") {
      return Response.json({
        profile: await savePayrollExportProfileDraft(database, actor, { ...body, profileId }),
      });
    }
    if (body.action === "new_draft") {
      return Response.json({
        profile: await createDraftFromPublishedPayrollProfile(database, actor, {
          ...body,
          profileId,
        }),
      });
    }
    if (body.action === "duplicate") {
      return Response.json(
        {
          profile: await duplicatePayrollExportProfile(database, actor, {
            name: body.name,
            profileId,
          }),
        },
        { status: 201 },
      );
    }
    if (body.action === "publish") {
      return Response.json(
        await publishPayrollExportProfile(database, actor, { ...body, profileId }),
      );
    }
    return Response.json({
      profile: await archivePayrollExportProfile(database, actor, { ...body, profileId }),
    });
  } catch (error) {
    return payrollErrorResponse(error, "給与連携プロファイルを更新できませんでした。");
  }
}
