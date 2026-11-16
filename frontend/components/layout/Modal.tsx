'use client';

import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

export function Modal({ title, children, onClose, drawer = false, closeDisabled = false }: { title: string; children: ReactNode; onClose(): void; drawer?: boolean; closeDisabled?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const t = useTranslations('Shell');
  useEffect(() => {
    const dialog = ref.current;
    const active = document.activeElement;
    const overflow = document.body.style.overflow;
    dialog?.showModal(); document.body.style.overflow = 'hidden';
    return () => { dialog?.close(); document.body.style.overflow = overflow; if (active instanceof HTMLElement) active.focus(); };
  }, []);
  function containTab(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key !== 'Tab') return;
    const dialog = event.currentTarget;
    const controls = Array.from(dialog.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, iframe, [tabindex]'))
      .filter((element) => element.tabIndex >= 0 && !element.matches(':disabled') && element.getClientRects().length > 0);
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
    const outside = !dialog.contains(document.activeElement);
    if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first.focus(); }
  }
  return <dialog ref={ref} className={drawer ? 'modal drawer' : 'modal'} aria-label={title} tabIndex={-1} onKeyDown={containTab} onCancel={(event) => { event.preventDefault(); onClose(); }} onClick={(event) => {
    if (event.target !== event.currentTarget) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  }}>
    <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label={t('close')} onClick={onClose} disabled={closeDisabled}><X size={21}/></button></div>
    {children}
  </dialog>;
}
