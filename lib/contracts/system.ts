import { z } from "zod";

export const autostartRegistrationSchema = z.enum([
  "absent",
  "valid",
  "invalid",
  "unknown",
]);

export type AutostartRegistration = z.infer<typeof autostartRegistrationSchema>;

export const autostartStatusSchema = z.object({
  supported: z.boolean(),
  enabled: z.boolean().nullable(),
  registration: autostartRegistrationSchema,
  backgroundReady: z.boolean(),
  reason: z.string().min(1).max(500).optional(),
}).strict();

export type AutostartStatus = z.infer<typeof autostartStatusSchema>;

export const autostartMutationSchema = z.object({
  enabled: z.boolean(),
}).strict();

export type AutostartMutation = z.infer<typeof autostartMutationSchema>;
