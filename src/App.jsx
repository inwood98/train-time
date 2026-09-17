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

function effectiveTime(s) {
  if (s.estimated) return new Date(s.estimated).getTime();
  return s.scheduled ? new Date(s.scheduled).getTime() : NaN;
}

function fmtCountdown(ms) {
  const mins = Math.round(ms / 60000);
  if (mins <= 0) return "due";
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${two(mins % 60)}m`;
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
      const res = await fetch(`/api/departures?from=${from}&to=${to}&count=90`);
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

function sortByTime(services) {
  return [...(services ?? [])].sort(
    (a, b) => new Date(a.scheduled).getTime() - new Date(b.scheduled).getTime()
  );
}

function Row({ departure, index, callsAt, showArrival, fastest }) {
  const st = statusOf(departure);
  const scheduled = hhmm(departure.scheduled);
  const estimated = hhmm(departure.estimated);
  const delayed =
    departure.estimated &&
    departure.scheduled &&
    effectiveTime(departure) !== new Date(departure.scheduled).getTime();
  const countdown = fmtCountdown(effectiveTime(departure) - Date.now());

  return (
    <div className={`row ${st.className}`}>
      <div className="cell num">{index + 1}</div>
      <div className="cell time">
        <span className="mono">{scheduled}</span>
        {delayed && <span className="est mono">est {estimated}</span>}
      </div>
      <div className="cell to">
        <span className="dest">
          {departure.destination}
          {fastest && <span className="badge fastest">fastest</span>}
        </span>
        <span className="calls">
          calls at {callsAt}
          {showArrival && departure.filterArrival && (
            <span className="arrive"> · arrives {hhmm(departure.filterArrival)}</span>
          )}
        </span>
      </div>
      <div className="cell status">
        <span className={`chip ${st.className}`}>{st.label}</span>
      </div>
      <div className="cell platform">
        {departure.platform ? <span className="mono">{departure.platform}</span> : "—"}
      </div>
      <div className="cell countdown">
        {!departure.cancelled && <span className="mono">{countdown}</span>}
      </div>
    </div>
  );
}

function Chip({ active, onClick, children }) {
  return (
    <button className={`chip-btn${active ? " active" : ""}`} onClick={onClick}>
      {children}
    </button>
  );
}

function Board({ data, direction, jumpHour, setJumpHour, destFilter, setDestFilter }) {
  const services = sortByTime(data.services);
  const callsAt = data.filterStation?.locationName ?? data.departureStation?.locationName;
  const now = Date.now();

  const hours = [...new Set(services.map((s) => new Date(s.scheduled).getHours()))].sort((a, b) => a - b);
  const destinations = [...new Set(services.map((s) => s.destination).filter(Boolean))].sort();
  const last = services[services.length - 1] ?? null;

  const alreadyDeparted = (s) => effectiveTime(s) + 60000 < now;

  let base;
  if (jumpHour !== null) {
    const hourServices = services.filter((s) => new Date(s.scheduled).getHours() === jumpHour);
    const firstAtHour = hourServices.length ? hourServices[0] : null;
    base = firstAtHour
      ? services.filter((s) => new Date(s.scheduled).getTime() >= new Date(firstAtHour.scheduled).getTime())
      : [];
  } else {
    base = services.filter((s) => !alreadyDeparted(s));
  }
  let list = destFilter ? base.filter((s) => s.destination === destFilter) : base;
  list = list.slice(0, 3);

  const legs = list.map((s) => (s.filterArrival ? new Date(s.filterArrival).getTime() - effectiveTime(s) : null));
  const minLeg = legs.length ? Math.min(...legs.filter((l) => l !== null && l >= 0)) : null;

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

      {last && (
        <div className="last">
          Last train tonight is <span className="mono">{hhmm(last.scheduled)}</span> → {last.destination}. Don't miss it!
        </div>
      )}

      {hours.length > 1 && (
        <div className="chips">
          <Chip active={jumpHour === null} onClick={() => setJumpHour(null)}>
            Now
          </Chip>
          {hours.map((h) => (
            <Chip key={h} active={jumpHour === h} onClick={() => setJumpHour(h)}>
              {two(h)}:00
            </Chip>
          ))}
        </div>
      )}

      {destinations.length > 1 && (
        <div className="chips filters">
          <Chip active={destFilter === null} onClick={() => setDestFilter(null)}>
            All trains
          </Chip>
          {destinations.map((d) => (
            <Chip key={d} active={destFilter === d} onClick={() => setDestFilter(d)}>
              {d}
            </Chip>
          ))}
        </div>
      )}

      <div className="cols">
        <span className="col num">#</span>
        <span className="col time">Time</span>
        <span className="col to">Destination</span>
        <span className="col status">Status</span>
        <span className="col platform">Plat</span>
        <span className="col countdown">Depart</span>
      </div>

      {list.length === 0 && (
        <div className="empty">
          {jumpHour !== null
            ? `No ${destFilter ? destFilter + " " : ""}trains from ${two(jumpHour)}:00 onwards.`
            : `No upcoming trains to ${callsAt} in the next few hours. Service may have ended for the night.`}
        </div>
      )}

      {list.map((departure, i) => (
        <Row
          key={departure.rid}
          departure={departure}
          index={i}
          callsAt={callsAt}
          showArrival={direction === "back"}
          fastest={direction === "back" && minLeg !== null && legs[i] === minLeg && legs[i] >= 0}
        />
      ))}
    </div>
  );
}

export default function App() {
  const [direction, setDirection] = useState("out");
  const [jumpHour, setJumpHour] = useState(null);
  const [destFilter, setDestFilter] = useState(null);
  const { boards, loading, error, updatedAt } = useBoards();
  const board = boards?.[direction] ?? null;

  const swap = () => {
    setDirection((d) => (d === "out" ? "back" : "out"));
    setJumpHour(null);
    setDestFilter(null);
  };

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
        <p className="sub">
          Next 3 departures · South Western Railway · data refreshes every 30 min
        </p>
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

      {board && (
        <Board
          key={direction}
          data={board}
          direction={direction}
          jumpHour={jumpHour}
          setJumpHour={setJumpHour}
          destFilter={destFilter}
          setDestFilter={setDestFilter}
        />
      )}

      <footer>
        {updatedAt ? `Board refreshes every 30s · Data updated by GitHub Actions every 30 min · Last check ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
      </footer>
    </div>
  );
}