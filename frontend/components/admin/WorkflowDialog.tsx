"use client";
import { useEffect, useRef, type ReactNode } from "react";
export function WorkflowDialog({
  title,
  children,
  busy = false,
  onClose,
}: {
  title: string;
  children: ReactNode;
  busy?: boolean;
  onClose(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const focused = document.activeElement;
    dialog.current?.showModal();
    return () => {
      if (focused instanceof HTMLElement) focused.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="wf-dialog workflow-page"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="wf-dialog-heading">
        <h2>{title}</h2>
        <button
          type="button"
          className="button secondary"
          disabled={busy}
          onClick={onClose}
        >
          Close
        </button>
      </div>
      <div className="wf-dialog-body">{children}</div>
    </dialog>
  );
}
