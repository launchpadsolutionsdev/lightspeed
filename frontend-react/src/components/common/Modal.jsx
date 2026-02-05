export default function Modal({ show, onClose, children, className = '' }) {
  if (!show) return null;

  return (
    <div className={`modal-overlay show`} onClick={onClose}>
      <div className={`modal-content ${className}`} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}
