export default function CoinRow({ budget, max = 20 }) {
  return (
    <div className="coin-row" role="img" aria-label={`${budget} of ${max} coins remaining`}>
      {Array.from({ length: max }).map((_, i) => (
        <span key={i} className={`coin ${i < budget ? "filled" : "spent"}`} />
      ))}
      <span className="coin-count">
        {budget}/{max}
      </span>
    </div>
  );
}
