/**
 * Modal shell: a centered desktop card that becomes a full-width bottom sheet
 * at the responsive breakpoint.
 *
 * Escape closes, focus moves into the dialog on open, and a backdrop click
 * dismisses. While open, background scrolling is locked and focus remains in
 * whichever control the user is interacting with across parent rerenders.
 */
import { useEffect, useRef, type ReactNode } from "react";

export function Modal({
  open,
  title,
  subtitle,
  icon,
  className,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: ReactNode;
  icon?: ReactNode;
  className?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKeyDown);
    cardRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`modal${className ? ` ${className}` : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={cardRef}
      >
        <div className="modal__head">
          <div className="modal__heading">
            {icon}
            <div>
              <h2 className="modal__title">{title}</h2>
              {subtitle && <p className="modal__sub">{subtitle}</p>}
            </div>
          </div>
          <button
            type="button"
            className="modal__close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
