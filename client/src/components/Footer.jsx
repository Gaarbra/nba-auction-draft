import { useState } from "react";
import InfoModal from "./InfoModal.jsx";
import { PAGES } from "../siteContent.jsx";

export default function Footer() {
  const [openPage, setOpenPage] = useState(null);

  return (
    <>
      <footer className="site-footer">
        {Object.entries(PAGES).map(([key, page]) => (
          <button key={key} type="button" className="site-footer-link" onClick={() => setOpenPage(key)}>
            {page.title}
          </button>
        ))}
      </footer>

      {openPage && (
        <InfoModal title={PAGES[openPage].title} body={PAGES[openPage].body} onClose={() => setOpenPage(null)} />
      )}
    </>
  );
}
