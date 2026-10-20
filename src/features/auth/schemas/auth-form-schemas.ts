import { z } from 'zod';

const requiredText = (message: string) =>
  z.string().refine((value) => value.trim().length > 0, message);

const emailSchema = z
  .string()
  .min(1, 'Enter your email address.')
  .email('Enter a valid email address.');
const passwordSchema = requiredText('Enter your password.');

export const loginFormSchema = z.object({ email: emailSchema, password: passwordSchema });
export const registerFormSchema = z.object({
  fullName: requiredText('Enter your full name.'),
  email: emailSchema,
  phone: requiredText('Enter your phone number.'),
  password: passwordSchema.min(6, 'Use at least 6 characters.'),
});

// Validation inspects whitespace without transforming the submitted values.
export type AuthFormValues = z.infer<typeof registerFormSchema>;
