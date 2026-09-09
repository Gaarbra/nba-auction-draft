import { useEffect, useMemo, useState } from "react";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:4000";
const TICKER_PLAYER_COUNT = 12;

/** A compact "instrument readout" strip of real active players with
 * randomized (not predicted) prices, replacing the old full-screen drifting
 * photo cards (see PriceTicker.jsx, still used behind the results screen)
 * with something that fits this screen's dashboard mood: a single quiet row
 * of amber Space Mono numbers, not a decorative background layer. Real
 * players, made-up prices, same reasoning as PriceTicker.jsx: hitting the
 * ML endpoint for a row nobody's meant to treat as an actual prediction
 * isn't worth the extra server load. */
export default function MarketTicker() {
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    fetch(`${SERVER_URL}/api/players?era=active&limit=${TICKER_PLAYER_COUNT}`)
      .then((res) => res.json())
      .then((data) => setPlayers(data.players || []))
      .catch(() => setPlayers([]));
  }, []);

  // Seeded so the same page load doesn't reshuffle prices on every
  // re-render, without needing to stash random values in state.
  const rows = useMemo(() => {
    let seed = 20260909;
    function rand() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }
    return players.map((p) => ({ id: p.id, fullName: p.fullName, price: 1 + Math.floor(rand() * 19) }));
  }, [players]);

  if (rows.length === 0) return null;

  return (
    <div className="market-ticker-bar" aria-hidden="true">
      <div className="market-ticker-bar-tag">
        <span className="market-ticker-bar-dot" />
        Live prices
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
              <span className="market-ticker-bar-price">{r.price}c</span>
            </div>
          ))}
          {rows.map((r) => (
            <div className="market-ticker-bar-row" key={`b-${r.id}`}>
              <span className="market-ticker-bar-name">{r.fullName}</span>
              <span className="market-ticker-bar-price">{r.price}c</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
