import { z } from "zod";

export const SCAN_QUEUE_NAME = "website-scans";

export const scanPhaseSchema = z.enum([
  "queued",
  "capturing_homepage",
  "selecting_pages",
  "capturing_pages",
  "running_technical_checks",
  "evaluating_ai",
  "generating_report",
  "completed",
  "failed",
]);

export type ScanPhase = z.infer<typeof scanPhaseSchema>;

export const scanSubmissionSchema = z.object({
  url: z.string().url().max(2_048),
  authorizedToScan: z.literal(true),
  activeSecurityChecksAuthorized: z.boolean().default(false),
  formSubmissionTestingAuthorized: z.boolean().default(false),
});

export type ScanSubmission = z.infer<typeof scanSubmissionSchema>;

export const aiCriterionKeySchema = z.enum([
  "beeldgebruik",
  "call_to_action",
  "actualiteit",
  "informatiearchitectuur",
  "vrijwilligerswerving",
  "taalgebruik",
  "contact_avg",
  "mobiele_ervaring",
  "brand_consistency",
]);

export type AiCriterionKey = z.infer<typeof aiCriterionKeySchema>;

export const aiCriterionSchema = z.object({
  score: z.number().int().min(1).max(5),
  toelichting: z.string().min(1).max(600),
  verbeterpunt: z.string().min(1).max(600),
  insufficientEvidence: z.boolean().default(false),
});

export const aiResultsSchema = z.object({
  criteria: z.record(aiCriterionKeySchema, aiCriterionSchema),
});

export type AiResults = z.infer<typeof aiResultsSchema>;

export const checkStatusSchema = z.enum(["pass", "warning", "fail", "unavailable"]);

export const technicalCheckSchema = z.object({
  status: checkStatusSchema,
  detail: z.string().min(1).max(1_000),
  score: z.number().min(0).max(100),
});

export const technicalCheckKeySchema = z.enum([
  "https",
  "mobile",
  "pagespeed",
  "cls",
  "ssl_chain",
  "dns_safety",
  "form_submission",
  "links_media",
  "accessibility",
  "seo_basics",
  "indexability",
  "structured_data",
  "social_metadata",
  "security_headers",
  "cms_version",
  "exposure",
]);

export type TechnicalCheckKey = z.infer<typeof technicalCheckKeySchema>;

export const technicalResultsSchema = z.record(technicalCheckKeySchema, technicalCheckSchema);
export type TechnicalResults = z.infer<typeof technicalResultsSchema>;

export const scanJobSchema = scanSubmissionSchema.extend({
  scanId: z.string().uuid(),
  submittedAt: z.string().datetime(),
});

export type ScanJob = z.infer<typeof scanJobSchema>;