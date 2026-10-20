import type { ReactNode } from 'react';
import { Alert, Button, Empty, Spin } from 'antd';

type ContentStateProps =
  | { kind: 'loading'; title: string; description?: string }
  | { kind: 'empty'; title: string; description?: string; action?: ReactNode }
  | {
      kind: 'error' | 'warning';
      title: string;
      description: string;
      onRetry?: () => void;
    };

// Render this instead of private children while a session/query is unavailable.
export function ContentState(props: ContentStateProps) {
  return (
    <section className="content-state" aria-label={props.title}>
      {props.kind === 'loading' ? (
        <div role="status" aria-live="polite" aria-busy="true" className="flex flex-col gap-4">
          <Spin />
          <h2>{props.title}</h2>
          {props.description && <p>{props.description}</p>}
        </div>
      ) : props.kind === 'empty' ? (
        <Empty
          description={
            <>
              <h2>{props.title}</h2>
              <p>{props.description}</p>
            </>
          }
        >
          {props.action}
        </Empty>
      ) : (
        <Alert
          type={props.kind}
          role={props.kind === 'error' ? 'alert' : 'status'}
          showIcon
          title={props.title}
          description={props.description}
          action={
            props.onRetry && (
              <Button htmlType="button" onClick={props.onRetry}>
                Try again
              </Button>
            )
          }
        />
      )}
    </section>
  );
}
