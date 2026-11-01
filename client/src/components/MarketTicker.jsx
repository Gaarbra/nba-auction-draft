/** Saved season leaders; updated with the homepage data status. */
export default function MarketTicker({ status }) {
  const rows = status?.seasonLeaders || [];
  if (rows.length === 0) return null;

  return (
    <div className="market-ticker-bar" aria-hidden="true">
      <div className="market-ticker-bar-tag">
        <span className="market-ticker-bar-dot" />
        {status.season} PPG
      </div>
      <div className="market-ticker-bar-divider" />
      <div className="market-ticker-bar-rows">
        {/* Two back-to-back copies of the same rows, scrolled left by
            exactly half the track's width via CSS (see index.css) -- a
            continuous right-to-left crawl like real market tickers, not a
            static list. React needs distinct keys per copy since both
            render the same player ids. */}
        <div className="market-ticker-bar-track">
          {rows.map((r) => (
            <div className="market-ticker-bar-row" key={`a-${r.id}`}>
              <span className="market-ticker-bar-name">{r.fullName}</span>
              <span className="market-ticker-bar-price">{r.pointsPerGame.toFixed(1)}</span>
            </div>
          ))}
          {rows.map((r) => (
            <div className="market-ticker-bar-row" key={`b-${r.id}`}>
              <span className="market-ticker-bar-name">{r.fullName}</span>
              <span className="market-ticker-bar-price">{r.pointsPerGame.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
