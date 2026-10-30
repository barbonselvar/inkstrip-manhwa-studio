import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
  onOpenAutoFocus,
  layerClassName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  wide?: boolean;
  /** Overrides Radix's first-tabbable focus, e.g. to start in a search field. */
  onOpenAutoFocus?: (event: Event) => void;
  /** Adds `<name>-overlay` and `<name>` so a modal nested in a higher layer can stack above it. */
  layerClassName?: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay
          className={`studio-modal-overlay overlay-in fixed inset-0 z-40 bg-ink/70 ${layerClassName ? `${layerClassName}-overlay` : ""}`}
        />
        <Dialog.Content
          onOpenAutoFocus={onOpenAutoFocus}
          className={`modal-in modal-panel ${wide ? "modal-wide" : ""} ${layerClassName ?? ""} fixed top-1/2 left-1/2 z-50 rounded-xl border border-border bg-bg-elevated p-5`}
        >
          <div className="modal-header flex items-start justify-between gap-3">
            <Dialog.Title className="font-display text-2xl text-fg">{title}</Dialog.Title>
            <Dialog.Close
              className="press focus-ring grid size-11 shrink-0 place-items-center rounded-sm text-muted hover:text-fg"
              aria-label="Close"
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          {description ? (
            <Dialog.Description className="mt-2 text-sm text-muted">
              {description}
            </Dialog.Description>
          ) : (
            <Dialog.Description className="sr-only">{title}</Dialog.Description>
          )}
          <div className="modal-body mt-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
