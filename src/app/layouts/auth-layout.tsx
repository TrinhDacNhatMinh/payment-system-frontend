import { useId, type PropsWithChildren, type ReactNode } from 'react';

import { Brand } from '@/shared/ui/brand';

type AuthLayoutProps = PropsWithChildren<{
  title: string;
  description: string;
  embedded?: boolean;
  footer?: ReactNode;
}>;

export function AuthLayout({
  title,
  description,
  embedded = false,
  footer,
  children,
}: AuthLayoutProps) {
  const headingId = useId();
  const Container = embedded ? 'div' : 'main';

  return (
    <Container className={embedded ? 'auth-layout auth-layout-embedded' : 'auth-layout'}>
      {!embedded && <Brand />}
      <section className="auth-card" aria-labelledby={headingId}>
        <header className="auth-heading">
          <h1 id={headingId}>{title}</h1>
          <p>{description}</p>
        </header>
        <div className="flex flex-col gap-6">{children}</div>
        {footer && <footer className="auth-footer">{footer}</footer>}
      </section>
    </Container>
  );
}
