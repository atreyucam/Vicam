import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { IconButton } from "./actions";
import { cx } from "./utils";

export interface DialogProps {
  children: ReactNode;
  className?: string;
  description: ReactNode;
  onClose: () => void;
  title: ReactNode;
}

export function Dialog({ children, className, description, onClose, title }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const portal = contentRef.current?.closest<HTMLElement>("[data-radix-portal]");
    const siblings = Array.from(document.body.children).filter(
      (element): element is HTMLElement => element instanceof HTMLElement && element !== portal,
    );
    const previous = siblings.map((element) => ({
      element,
      inert: element.inert,
    }));
    siblings.forEach((element) => {
      element.inert = true;
    });
    return () => {
      previous.forEach(({ element, inert }) => {
        element.inert = inert;
      });
      const returnFocus = returnFocusRef.current;
      requestAnimationFrame(() => returnFocus?.isConnected && returnFocus.focus());
    };
  }, []);

  return (
    <DialogPrimitive.Root
      modal
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="modal-backdrop" />
        <DialogPrimitive.Content
          aria-describedby={descriptionId}
          aria-labelledby={titleId}
          className={cx("modal", className)}
          onOpenAutoFocus={(event) => {
            const initialFocus = contentRef.current?.querySelector<HTMLElement>(
              "[data-dialog-initial-focus]",
            );
            if (!initialFocus) return;
            event.preventDefault();
            initialFocus.focus();
          }}
          ref={contentRef}
        >
          <div className="vicam-dialog__header">
            <DialogPrimitive.Title id={titleId}>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <IconButton accessibleLabel="Cerrar diálogo">
                <X aria-hidden="true" size={20} />
              </IconButton>
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description asChild>
            <div className="vicam-dialog__description" id={descriptionId}>
              {description}
            </div>
          </DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
