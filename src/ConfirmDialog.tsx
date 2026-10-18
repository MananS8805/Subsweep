import Modal from './Modal';

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** An accessible yes/no for destructive actions. Focus starts on Cancel, so Enter never deletes by accident. */
export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onCancel }: Props) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p>{message}</p>
      <div className="row-actions">
        <button className="btn" onClick={onCancel}>Cancel</button>
        <button className="btn danger-btn" onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
