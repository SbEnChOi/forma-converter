import { useEffect, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';

export default function Modal({ title, description, onClose, children, wide = false }: {
  title: string;
  description?: string;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = 'forma-dialog-title';
  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    const close = () => onClose();
    dialog.addEventListener('close', close);
    return () => dialog.removeEventListener('close', close);
  }, [onClose]);

  return <dialog ref={ref} className={`modal ${wide ? 'modal-wide' : ''}`} aria-labelledby={titleId}
    aria-describedby={description ? 'forma-dialog-description' : undefined}
    onClick={event => { if (event.target === event.currentTarget) ref.current?.close(); }}>
    <div className="modal-heading">
      <div><h2 id={titleId}>{title}</h2>{description && <p id="forma-dialog-description">{description}</p>}</div>
      <button className="icon-button" title="닫기" aria-label="닫기" onClick={() => ref.current?.close()}><X size={18} /></button>
    </div>
    {children}
  </dialog>;
}
