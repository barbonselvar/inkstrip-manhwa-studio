import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
export function ToolSection({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="tool-section" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        <span>{title}</span>
        <ChevronDown className="size-4" aria-hidden="true" />
      </summary>
      <div className="tool-section-body">{children}</div>
    </details>
  );
}
