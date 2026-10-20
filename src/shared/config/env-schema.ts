import { z } from 'zod';

const apiOriginSchema = z
  .string()
  .url()
  .superRefine((value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      // The URL validator already records this failure.
      return;
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Use an HTTP(S) origin without credentials, path, query, or fragment.',
      });
    }
  });

const environmentSchema = z.object({ VITE_API_BASE_URL: apiOriginSchema });

export function parseEnvironment(environment: Record<string, unknown>) {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    // Do not include the supplied value: a mistaken URL can contain credentials.
    throw new Error('Invalid VITE_API_BASE_URL. Configure an HTTP(S) API origin in .env.local.');
  }
  return { apiBaseUrl: new URL(result.data.VITE_API_BASE_URL).origin };
}
