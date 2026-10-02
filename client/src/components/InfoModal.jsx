import { useEffect, useId, useRef } from "react";

export default function InfoModal({ title, body, onClose }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => dialog.close();
  }, []);
  return <dialog ref={ref} className="info-dialog" aria-labelledby={titleId} onCancel={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="footer-modal">
      <div className="footer-modal-header">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="footer-modal-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="footer-modal-body">{body}</div>
    </div>
  </dialog>;
}
