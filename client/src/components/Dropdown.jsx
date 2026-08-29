import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";

/** A styled stand-in for a native <select> — same idea (pick one of a list
 * of options), but themeable to match the rest of the app instead of
 * whatever plain OS-native dropdown the browser would otherwise draw. Not
 * used anywhere load-bearing enough to need full listbox ARIA semantics;
 * kept simple (a button + an absolutely-positioned menu) on purpose. */
export default function Dropdown({ options, value, onChange, placeholder = "Select…", className = "" }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    function handleClickOutside(e) {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    }
    function handleEscape(e) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div className={`dropdown ${className}`} ref={rootRef}>
      <button
        type="button"
        className={`dropdown-trigger ${open ? "open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="dropdown-trigger-label">{selected ? selected.label : placeholder}</span>
        <motion.span
          className="dropdown-chevron"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.15 }}
          aria-hidden="true"
        >
          ▾
        </motion.span>
      </button>
      {/* No AnimatePresence/exit — same reasoning as the footer modal and
          DraftBoard's nomination panel: an exit animation that never
          resolves would leave the menu stuck open, overlapping whatever's
          rendered underneath it. Entrance-only still feels right for a
          menu that only ever opens for a moment. */}
      {open && (
        <motion.ul
          className="dropdown-menu"
          role="listbox"
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.12 }}
        >
          {options.map((option) => (
            <li key={option.value}>
              <button
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`dropdown-option ${option.value === value ? "selected" : ""}`}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </motion.ul>
      )}
    </div>
  );
}
