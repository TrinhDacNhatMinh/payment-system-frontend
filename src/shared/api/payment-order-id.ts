import { z } from 'zod';

export const paymentOrderIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
