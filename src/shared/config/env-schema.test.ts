import { describe, expect, it } from 'vitest';

import { parseEnvironment } from './env-schema';

describe('API environment configuration', () => {
  it.each(['http://localhost:8080', 'https://api.example.com/'])(
    'accepts and normalizes the API origin %s',
    (origin) => {
      expect(parseEnvironment({ VITE_API_BASE_URL: origin }).apiBaseUrl).toBe(
        new URL(origin).origin,
      );
    },
  );

  it.each([
    undefined,
    '',
    '/api',
    'ftp://api.example.com',
    'https://api.example.com/api/v1',
    'https://api.example.com?token=private',
    'https://api.example.com#fragment',
    'https://user:private@api.example.com',
  ])('rejects missing or unsafe API configuration', (origin) => {
    expect(() => parseEnvironment({ VITE_API_BASE_URL: origin })).toThrow(
      'Invalid VITE_API_BASE_URL.',
    );
  });

  it('does not expose credentials from invalid configuration', () => {
    expect(() =>
      parseEnvironment({ VITE_API_BASE_URL: 'https://user:private@api.example.com' }),
    ).toThrow(/^Invalid VITE_API_BASE_URL\. Configure an HTTP\(S\) API origin in \.env\.local\.$/);
  });
});
