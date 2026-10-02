import { useLayoutEffect, useRef, useState } from "react";
import InfoModal from "./InfoModal.jsx";
import { PAGES } from "../siteContent.jsx";

export default function Footer({ inRoom = false }) {
  const [openPage, setOpenPage] = useState(null);
  const footerRef = useRef(null);
  useLayoutEffect(() => {
    if (!inRoom) return;
    const footer = footerRef.current;
    const update = () => document.documentElement.style.setProperty("--room-footer-height", `${footer.getBoundingClientRect().height}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(footer);
    return () => { observer.disconnect(); document.documentElement.style.removeProperty("--room-footer-height"); };
  }, [inRoom]);
  return <>
    <footer ref={footerRef} className={inRoom ? "room-footer" : "site-footer"}>
      <span className="footer-attribution">Fan-made · Data: <a href="https://www.nba.com/" target="_blank" rel="noreferrer">NBA.com</a></span>
      <nav aria-label="Help and legal" className="footer-links">
        {Object.entries(PAGES).map(([key, page]) => <button key={key} type="button" className="site-footer-link" onClick={() => setOpenPage(key)}>{page.title}</button>)}
        <button type="button" className="site-footer-link" onClick={() => window.dispatchEvent(new Event("analytics:preferences"))}>Analytics choices</button>
      </nav>
    </footer>
    {openPage && <InfoModal title={PAGES[openPage].title} body={PAGES[openPage].body} onClose={() => setOpenPage(null)} />}
  </>;
}
