import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import TeamBadge from "./TeamBadge.jsx";
import { getTeamColors } from "../teamColors.js";

/** Same interaction shell as Dropdown.jsx (button + absolutely-positioned
 * menu, click-outside/Escape to close), but built specifically for the
 * Market tab's team filter: each row carries that team's own real logo and
 * a wash of their own real colors, instead of being plain text -- "team
 * colors with the logo on the side" applies to the whole control, not just
 * the closed trigger. */
export default function TeamDropdown({ options, value, onChange, placeholder = "Choose a team" }) {
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
  const selectedColors = selected ? getTeamColors(selected.value) : null;

  return (
    <div className={`dropdown team-dropdown ${open ? "open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="dropdown-trigger team-dropdown-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={
          selectedColors
            ? {
                "--team-primary": selectedColors.primary,
                "--team-secondary": selectedColors.secondary,
              }
            : undefined
        }
      >
        {selected ? (
          <span className="team-dropdown-selected">
            <TeamBadge abbreviation={selected.value} size={22} />
            <span className="dropdown-trigger-label">{selected.label}</span>
          </span>
        ) : (
          <span className="dropdown-trigger-label">{placeholder}</span>
        )}
        <motion.span
          className="dropdown-chevron"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.15 }}
          aria-hidden="true"
        >
          ▾
        </motion.span>
      </button>

      {open && (
        <motion.ul
          className="dropdown-menu team-dropdown-menu"
          role="listbox"
          initial={{ opacity: 0, y: -6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.12 }}
        >
          {options.map((option) => {
            const colors = getTeamColors(option.value);
            return (
              <li key={option.value}>
                <button
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  className={`dropdown-option team-dropdown-option ${option.value === value ? "selected" : ""}`}
                  style={{
                    "--team-primary": colors.primary,
                    "--team-secondary": colors.secondary,
                  }}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                >
                  <TeamBadge abbreviation={option.value} size={26} />
                  <span className="team-dropdown-option-label">{option.label}</span>
                </button>
              </li>
            );
          })}
        </motion.ul>
      )}
    </div>
  );
}
