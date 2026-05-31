export default function PlatformCard({
  name,
  description,
  icon,
  status = "not_connected",
  onConnect,
  onManage
}) {
  const connected = status === "connected";

  return (
    <div className="platform-card">
      <div className="platform-icon">{icon}</div>

      <h3>{name}</h3>
      <p>{description}</p>

      <span className={connected ? "badge connected" : "badge"}>
        {connected ? "Connected" : "Not Connected"}
      </span>

      <div className="platform-actions">
        {connected ? (
          <button onClick={onManage}>Manage</button>
        ) : (
          <button onClick={onConnect}>Connect</button>
        )}
      </div>
    </div>
  );
}
