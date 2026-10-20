import type { PropsWithChildren } from 'react';
import { Typography } from 'antd';

export function RoutePlaceholder({ title, children }: PropsWithChildren<{ title: string }>) {
  return (
    <main className="scaffold-page flex justify-center items-start">
      <section className="scaffold-panel" aria-labelledby="page-title">
        <Typography.Paragraph type="secondary">Payment System</Typography.Paragraph>
        <Typography.Title level={1} id="page-title">
          {title}
        </Typography.Title>
        {children}
      </section>
    </main>
  );
}
