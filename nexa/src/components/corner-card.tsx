export function CornerCard({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`corner-card ${className}`}>
      <span className="corner-bl" />
      {children}
    </div>
  );
}
