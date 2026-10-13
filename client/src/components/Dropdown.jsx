import { useEffect, useId, useRef, useState } from "react";

export default function Dropdown({ options, value, onChange, label = "Choose an option", placeholder = "Select…", className = "" }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState({ above: false, height: 260 });
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const menuRef = useRef(null);
  const menuId = useId();
  const selected = options.find((option) => option.value === value);

  function closeMenu() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function openMenu() {
    const rect = triggerRef.current.getBoundingClientRect();
    const below = window.innerHeight - rect.bottom - 12;
    const above = rect.top - 12;
    const opensAbove = below < 260 && above > below;
    setPlacement({ above: opensAbove, height: Math.max(0, Math.min(260, opensAbove ? above : below)) });
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return undefined;
    const menu = menuRef.current;
    (menu.querySelector('[aria-selected="true"]') || menu.querySelector('[role="option"]'))?.focus();
    function handleOutside(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    function handleResize() { setOpen(false); }
    document.addEventListener("pointerdown", handleOutside);
    window.addEventListener("resize", handleResize);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      window.removeEventListener("resize", handleResize);
    };
  }, [open]);

  function handleMenuKey(event, index) {
    const last = options.length - 1;
    const target = { ArrowDown: (index + 1) % options.length, ArrowUp: (index + last) % options.length, Home: 0, End: last }[event.key];
    if (target !== undefined) {
      event.preventDefault();
      menuRef.current.querySelectorAll('[role="option"]')[target]?.focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
    } else if (event.key.length === 1 && event.key !== " " && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const match = options.findIndex((_, offset) => options[(index + 1 + offset) % options.length].label.toLowerCase().startsWith(event.key.toLowerCase()));
      if (match !== -1) {
        event.preventDefault();
        menuRef.current.querySelectorAll('[role="option"]')[(index + 1 + match) % options.length]?.focus();
      }
    }
  }

  return (
    <div className={`dropdown ${className}`} ref={rootRef}
      onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
      <button type="button" ref={triggerRef}
        className={`dropdown-trigger ${open ? "open" : ""}`}
        onClick={() => open ? closeMenu() : openMenu()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openMenu();
          }
        }}
        aria-label={`${label}: ${selected?.label || placeholder}`}
        aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? menuId : undefined}>
        <span className="dropdown-trigger-label">{selected?.label || placeholder}</span>
        <svg className="dropdown-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <ul id={menuId} ref={menuRef} className={`dropdown-menu ${placement.above ? "dropdown-menu-above" : ""}`}
          style={{ maxHeight: placement.height }} data-lenis-prevent role="listbox" aria-label={label}>
          {options.map((option, index) => (
            <li key={option.value} role="presentation">
              <button type="button" role="option" tabIndex={-1}
                aria-selected={option.value === value}
                className={`dropdown-option ${option.value === value ? "selected" : ""}`}
                onKeyDown={(event) => handleMenuKey(event, index)}
                onClick={() => { onChange(option.value); closeMenu(); }}>
                <span>{option.label}</span>
                {option.value === value && <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
