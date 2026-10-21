import { z } from 'zod';

export const apiIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

// LocalDateTime is interpreted as Asia/Ho_Chi_Minh by contract. Keep the
// original string, including microseconds; never append Z or use new Date().
export const vietnamDateTimeSchema = z.iso
  .datetime({ local: true })
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?$/);
