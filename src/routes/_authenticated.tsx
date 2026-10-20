import { createFileRoute } from '@tanstack/react-router';

import { SignInPage } from '@/features/auth/pages/sign-in-page';

// Deny access until I1-07/08 adds the verified session gate. Do not add private
// loaders/prefetch here before that gate can stop them before execution.
export const Route = createFileRoute('/_authenticated')({ component: SignInPage });
