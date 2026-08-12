export default function NominationForm({ onNominate, error }) {
  return (
    <div className="nomination-form">
      <h3>Your turn to nominate</h3>
      <p className="hint-text">A random player will be drawn from this room's pool for everyone to bid on.</p>
      <button type="button" onClick={onNominate} className="primary-btn">
        Reveal Random Player
      </button>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
