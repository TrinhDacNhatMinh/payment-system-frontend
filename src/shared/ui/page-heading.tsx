export function PageHeading({ title, description }: { title: string; description?: string }) {
  return (
    <header className="page-heading">
      <h1>{title}</h1>
      {description && <p>{description}</p>}
    </header>
  );
}
