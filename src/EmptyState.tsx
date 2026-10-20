interface Props {
  title: string;
  children?: React.ReactNode;   // the explanation
  action?: { label: string; onClick: () => void };
}

/** A plain, text-only empty state. Nothing decorative, so there is nothing for a screen reader to skip. */
export default function EmptyState({ title, children, action }: Props) {
  return (
    <div className="empty-state" role="status">
      <p className="empty-title"><strong>{title}</strong></p>
      {children && <p className="muted">{children}</p>}
      {action && <div className="row-actions start"><button className="btn" onClick={action.onClick}>{action.label}</button></div>}
    </div>
  );
}
