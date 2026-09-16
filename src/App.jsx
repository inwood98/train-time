import { useCallback, useEffect, useRef, useState } from "react";

const REFRESH_MS = 30000;

function two(n) {
  return String(n).padStart(2, "0");
}

function hhmm(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

function minsUntil(iso) {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.round(ms / 60000);
}

function statusOf(s) {
  if (s.cancelled) return { label: "Cancelled", className: "cancelled" };
  if (s.status === "Late") return { label: "Late", className: "late" };
  if (s.status === "Delayed") return { label: "Delayed", className: "delayed" };
  if (s.status === "OnTime") return { label: "On time", className: "on-time" };
  return { label: s.status || "—", className: "unknown" };
}

const DIRECTIONS = {
  out: { from: "SNS", to: "TWI", fallbackName: ["Staines", "Twickenham"] },
  back: { from: "TWI", to: "SNS", fallbackName: ["Twickenham", "Staines"] },
};

async function loadSnapshot() {
  const res = await fetch("data/departures.json");
  if (!res.ok) throw new Error(`Snapshot missing (${res.status})`);
  return res.json();
}

async function loadApiFallback() {
  const [out, back] = await Promise.all(
    ["out", "back"].map(async (key) => {
      const { from, to } = DIRECTIONS[key];
      const res = await fetch(`/api/departures?from=${from}&to=${to}&count=3`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return res.json();
    })
  );
  return { generatedAt: new Date().toISOString(), directions: { out, back } };
}

function useBoards() {
  const [state, setState] = useState({
    boards: null,
    loading: true,
    error: null,
    updatedAt: null,
  });
  const timer = useRef(null);

  const load = useCallback(async () => {
    try {
      let snapshot;
      try {
        snapshot = await loadSnapshot();
      } catch {
        snapshot = await loadApiFallback();
      }
      setState({
        boards: snapshot.directions,
        loading: false,
        error: null,
        updatedAt: new Date(),
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message }));
    }
  }, []);

  useEffect(() => {
    load();
    timer.current = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [load]);

  return state;
}

function Row({ departure, index, callsAt }) {
  const st = statusOf(departure);
  const scheduled = hhmm(departure.scheduled);
  const estimated = hhmm(departure.estimated);
  const delayed =
    departure.estimated &&
    departure.scheduled &&
    new Date(departure.estimated).getTime() !== new Date(departure.scheduled).getTime();
  const countdown = minsUntil(delayed ? departure.estimated : departure.scheduled);

  return (
    <div className={`row ${st.className}`}>
      <div className="cell num">{index + 1}</div>
      <div className="cell time">
        <span className="mono">{scheduled}</span>
        {delayed && <span className="est mono">est {estimated}</span>}
      </div>
      <div className="cell to">
        <span className="dest">{departure.destination}</span>
        <span className="calls">calls at {callsAt}</span>
      </div>
      <div className="cell status">
        <span className={`chip ${st.className}`}>{st.label}</span>
      </div>
      <div className="cell platform">
        {departure.platform ? <span className="mono">{departure.platform}</span> : "—"}
      </div>
      <div className="cell countdown">
        {countdown !== null && !departure.cancelled && (
          <span className="mono">{countdown <= 0 ? "due" : `${countdown}m`}</span>
        )}
      </div>
    </div>
  );
}

function Board({ data }) {
  const callsAt = data.filterStation?.locationName ?? data.departureStation?.locationName;
  return (
    <div className="board">
      <div className="board-head">
        <div className="route">
          <span className="station">{data.departureStation?.locationName}</span>
          <span className="arrow">→</span>
          <span className="station">{data.filterStation?.locationName}</span>
        </div>
        <div className="updated">
          {data.generatedAt ? `Live board · updated ${hhmm(data.generatedAt)}` : "Departures"}
        </div>
      </div>
      <div className="cols">
        <span className="col num">#</span>
        <span className="col time">Time</span>
        <span className="col to">Destination</span>
        <span className="col status">Status</span>
        <span className="col platform">Plat</span>
        <span className="col countdown">Depart</span>
      </div>
      {data.services.length === 0 && <div className="empty">No departures found.</div>}
      {data.services.map((departure, i) => (
        <Row key={departure.rid} departure={departure} index={i} callsAt={callsAt} />
      ))}
    </div>
  );
}

export default function App() {
  const [direction, setDirection] = useState("out");
  const { boards, loading, error, updatedAt } = useBoards();
  const board = boards?.[direction] ?? null;

  const swap = () => setDirection((d) => (d === "out" ? "back" : "out"));

  const names = board
    ? [board.departureStation?.locationName, board.filterStation?.locationName]
    : DIRECTIONS[direction].fallbackName;

  return (
    <div className="app">
      <header>
        <h1>
          <span className="h1a">{names[0]}</span>
          <span className="arrow"> → </span>
          <span className="h1b">{names[1]}</span>
        </h1>
        <p className="sub">Next 3 departures · South Western Railway</p>
        <button className="swap" onClick={swap}>
          <span aria-hidden="true">⇄</span> Swap direction
        </button>
      </header>

      {loading && !board && <div className="message">Loading live departures…</div>}

      {error && (
        <div className="message error">
          Could not load departures: {error}
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      )}

      {board && <Board key={direction} data={board} />}

      <footer>
        {updatedAt ? `Auto-refreshes every 30s · Last check ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
      </footer>
    </div>
  );
}