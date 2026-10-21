import { z } from "zod";
import { count, dateStr } from "../middleware/validate";
import { DEFAULT_TZ, isValidDate, todayIn } from "./dates";

const fileName = z
  .string()
  .regex(/^[a-f0-9]{32}\.(pdf|csv|xlsx|png|jpg)$/, "Invalid file reference")
  .nullish();

const extractedJson = z
  .string()
  .max(20_000)
  .refine((s) => {
    try {
      JSON.parse(s);
      return true;
    } catch {
      return false;
    }
  }, "Must be valid JSON")
  .nullish();

/** Business rules for one daily entry. `today` is injectable for tests. */
export function metricSchema(today: () => string = () => todayIn(DEFAULT_TZ)) {
  return z
    .object({
      reportDate: dateStr,
      campaign: z.string().trim().min(1, "Campaign is required").max(100),
      waRecipients: count,
      waDelivered: count,
      emailSent: count,
      emailOpened: count,
      notes: z.string().trim().max(1000).nullish(),
      waSourceFile: fileName,
      emailSourceFile: fileName,
      waExtractedJson: extractedJson,
      emailExtractedJson: extractedJson,
    })
    .superRefine((v, ctx) => {
      if (!isValidDate(v.reportDate)) {
        ctx.addIssue({ code: "custom", path: ["reportDate"], message: "Not a real calendar date" });
      } else if (v.reportDate > today()) {
        ctx.addIssue({ code: "custom", path: ["reportDate"], message: "Date cannot be in the future" });
      }
      if (v.waDelivered > v.waRecipients) {
        ctx.addIssue({ code: "custom", path: ["waDelivered"], message: "WhatsApp delivered cannot be more than recipients" });
      }
      if (v.emailOpened > v.emailSent) {
        ctx.addIssue({ code: "custom", path: ["emailOpened"], message: "Emails opened cannot be more than emails sent" });
      }
    });
}

export type MetricInput = z.infer<ReturnType<typeof metricSchema>>;
