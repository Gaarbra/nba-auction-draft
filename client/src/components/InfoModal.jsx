import { motion } from "motion/react";

/** The footer-modal shell (backdrop + card + header + close), extracted
 * from Footer.jsx so DraftBoard's mid-draft help button can show the exact
 * same "How to Play" content without duplicating the modal markup. */
export default function InfoModal({ title, body, onClose }) {
  return (
    <div className="footer-modal-backdrop" onClick={onClose}>
      {/* No AnimatePresence/exit here on purpose — a modal is load-bearing
          (it blocks the whole page while open), and an exit transition that
          never resolves would leave it stuck open forever with no way to
          close it. A plain conditional render with only an entrance
          animation still pops in nicely; closing is just an instant unmount,
          same trade-off already made for DraftBoard's nomination panel. */}
      <motion.div
        className="footer-modal"
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: "spring", stiffness: 320, damping: 30 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="footer-modal-header">
          <h2>{title}</h2>
          <button type="button" className="footer-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="footer-modal-body">{body}</div>
      </motion.div>
    </div>
  );
}
