import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import {
  buildLeadsBySourceReport,
  buildNewLeadsReport,
  buildReportWorkbook,
  renderReportHtmlTable,
  renderReportPlainText,
  type ReportContactRow,
} from "@echoline/core";
import { sendDbError } from "../errors.js";
import { sendPlatformEmail } from "../platformEmail.js";

const REPORT_TYPES = ["new_leads", "leads_by_source"] as const;
type ReportType = (typeof REPORT_TYPES)[number];

const REPORT_TITLE: Record<ReportType, string> = {
  new_leads: "New leads",
  leads_by_source: "Leads by source",
};

const configInput = z.object({
  recipientEmail: z.string().email(),
  format: z.enum(["table", "excel"]),
  sendTime: z.string().regex(/^\d{2}:\d{2}$/, "sendTime must be HH:MM"),
  enabled: z.boolean(),
});

function isReportType(value: string): value is ReportType {
  return (REPORT_TYPES as readonly string[]).includes(value);
}

/**
 * Per-project configuration for the Reports tab's two daily digests (new
 * leads / leads by source), each independently configurable — recipient,
 * format (inline table vs. Excel attachment), send time, enabled. The
 * scheduled send itself lives in apps/worker/src/reportSend.ts; these
 * routes are just config CRUD plus an on-demand "send test now."
 */
export const reportConfigRoutes: FastifyPluginAsync = async (app) => {
  app.get("/projects/:projectId/reports/configs", async (req, reply) => {
    const { projectId } = req.params as { projectId: string };
    const { data, error } = await req.supabase.from("report_configs").select("*").eq("project_id", projectId);
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.put("/projects/:projectId/reports/configs/:reportType", async (req, reply) => {
    const { projectId, reportType } = req.params as { projectId: string; reportType: string };
    if (!isReportType(reportType)) return reply.code(404).send({ error: "not_found" });
    const body = configInput.parse(req.body);

    const { data: project, error: projErr } = await req.supabase.from("projects").select("org_id").eq("id", projectId).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });

    const { data, error } = await req.supabase
      .from("report_configs")
      .upsert(
        {
          project_id: projectId,
          org_id: (project as { org_id: string }).org_id,
          report_type: reportType,
          recipient_email: body.recipientEmail,
          format: body.format,
          send_time: body.sendTime,
          enabled: body.enabled,
        },
        { onConflict: "project_id,report_type" }
      )
      .select()
      .single();
    if (error) return sendDbError(reply, error);
    return data;
  });

  app.post("/projects/:projectId/reports/configs/:reportType/send-test", async (req, reply) => {
    const { projectId, reportType } = req.params as { projectId: string; reportType: string };
    if (!isReportType(reportType)) return reply.code(404).send({ error: "not_found" });
    const body = z
      .object({
        to: z.string().email().optional(),
        from: z.string().datetime().optional(),
        toDate: z.string().datetime().optional(),
      })
      .parse(req.body ?? {});

    const { data: project, error: projErr } = await req.supabase.from("projects").select("org_id").eq("id", projectId).maybeSingle();
    if (projErr) return sendDbError(reply, projErr);
    if (!project) return reply.code(404).send({ error: "not_found" });

    let recipient = body.to;
    let format: "table" | "excel" = "table";
    if (!recipient) {
      const { data: config } = await req.supabase
        .from("report_configs")
        .select("recipient_email, format")
        .eq("project_id", projectId)
        .eq("report_type", reportType)
        .maybeSingle();
      if (!config) return reply.code(400).send({ error: "validation_error", message: "No saved recipient — save the report config first, or pass `to` explicitly." });
      recipient = (config as { recipient_email: string }).recipient_email;
      format = (config as { format: "table" | "excel" }).format;
    }

    let contactsQuery = req.supabase.from("contacts").select("name, email, phone, category, area, source, created_at").eq("project_id", projectId);
    if (body.from) contactsQuery = contactsQuery.gte("created_at", body.from);
    if (body.toDate) contactsQuery = contactsQuery.lte("created_at", body.toDate);
    const { data: contacts, error: contactsErr } = await contactsQuery;
    if (contactsErr) return sendDbError(reply, contactsErr);

    const rows = (contacts ?? []) as ReportContactRow[];
    const table = reportType === "new_leads" ? buildNewLeadsReport(rows) : buildLeadsBySourceReport(rows);
    const title = `${REPORT_TITLE[reportType]} — test send`;

    try {
      if (format === "excel") {
        const buffer = await buildReportWorkbook(table, REPORT_TITLE[reportType]);
        await sendPlatformEmail({
          to: recipient,
          subject: title,
          html: renderReportHtmlTable({ headers: table.headers, rows: [] }, title).replace(
            "No rows for this period.",
            "See the attached spreadsheet."
          ),
          text: `${title}\n\nSee the attached spreadsheet.`,
          attachments: [
            {
              filename: `${reportType}.xlsx`,
              content: buffer.toString("base64"),
              contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            },
          ],
        });
      } else {
        await sendPlatformEmail({
          to: recipient,
          subject: title,
          html: renderReportHtmlTable(table, title),
          text: renderReportPlainText(table, title),
        });
      }
    } catch (err) {
      return reply.code(502).send({ error: "email_failed", message: err instanceof Error ? err.message : String(err) });
    }

    return { ok: true, sentTo: recipient, rows: rows.length };
  });
};
