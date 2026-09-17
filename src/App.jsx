import { useCallback, useEffect, useRef, useState } from "react";

const REFRESH_MS = 30000;

const STATIONS = [
  { crs: "SNS", name: "Staines" },
  { crs: "TWI", name: "Twickenham" },
  { crs: "WAT", name: "London Waterloo" },
];

const PAIRS = [];
for (const a of STATIONS) {
  for (const b of STATIONS) {
    if (a.crs !== b.crs) PAIRS.push({ from: a.crs, to: b.crs });
  }
}

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

async function loadSnapshot() {
  const res = await fetch("data/departures.json");
  if (!res.ok) throw new Error(`Snapshot missing (${res.status})`);
  return res.json();
}

async function loadApiFallback() {
  const entries = await Promise.all(
    PAIRS.map(async ({ from, to }) => {
      const res = await fetch(`/api/departures?from=${from}&to=${to}&count=90`);
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      return [`${from}:${to}`, await res.json()];
    })
  );
  return { generatedAt: new Date().toISOString(), directions: Object.fromEntries(entries) };
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

function Row({ departure, index, toName, fastest }) {
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
        <span className="mono time-main">{scheduled}</span>
        {delayed && <span className="est mono">est {estimated}</span>}
      </div>
      <div className="cell to">
        <span className="dest">
          {departure.destination}
          {fastest && <span className="badge fastest">fastest</span>}
        </span>
        <span className="calls">
          calls at {toName}
          {departure.filterArrival && (
            <span className="arrive"> · arrives {hhmm(departure.filterArrival)}</span>
          )}
        </span>
      </div>
      <div className="cell meta">
        <span className={`chip ${st.className}`}>{st.label}</span>
        <span className="plat mono">{departure.platform ? `Plat ${departure.platform}` : "—"}</span>
        {!departure.cancelled && <span className="mono countdown">{countdown}</span>}
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

function Picker({ open, children }) {
  if (!open) return null;
  return <div className="picker">{children({ Chip })}</div>;
}

function Board({ data, toName, jumpHour, setJumpHour, destFilter, setDestFilter }) {
  const [panel, setPanel] = useState(null); // null | 'time' | 'dest'
  const services = sortByTime(data.services);
  const now = Date.now();

  const hours = [...new Set(services.map((s) => new Date(s.scheduled).getHours()))].sort((a, b) => a - b);
  const destinations = [...new Set(services.map((s) => s.destination).filter(Boolean))].sort();
  const last = services[services.length - 1] ?? null;

  const alreadyDeparted = (s) => effectiveTime(s) + 60000 < now;

  let base;
  if (jumpHour !== null) {
    base = services.filter((s) => new Date(s.scheduled).getHours() === jumpHour);
  } else {
    base = services.filter((s) => !alreadyDeparted(s));
  }
  let list = destFilter ? base.filter((s) => s.destination === destFilter) : base;
  const MAX_ROWS = 200;
  const truncated = list.length > MAX_ROWS;
  list = list.slice(0, MAX_ROWS);

  const legs = list.map((s) =>
    s.filterArrival ? new Date(s.filterArrival).getTime() - effectiveTime(s) : null
  );
  const validLegs = legs.filter((l) => l !== null && l >= 0);
  const minLeg = validLegs.length ? Math.min(...validLegs) : null;
  const showFastest = validLegs.length && new Set(validLegs.map((l) => Math.round(l / 60000))).size > 1;

  const toggle = (p) => setPanel((cur) => (cur === p ? null : p));
  const pickTime = (h) => {
    setJumpHour(h);
    setPanel(null);
  };
  const pickDest = (d) => {
    setDestFilter(d);
    setPanel(null);
  };

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
          Last train tonight is the <span className="mono">{hhmm(last.scheduled)}</span> → {last.destination}. Don't miss it!
        </div>
      )}

      {(hours.length > 1 || destinations.length > 1) && (
        <div className="board-tools">
          {hours.length > 1 && (
            <div className="tool">
              <button className={`tool-btn${panel === "time" ? " open" : ""}`} onClick={() => toggle("time")}>
                <span>{jumpHour === null ? "Now" : `${two(jumpHour)}:00`}</span>
                <span className="chev">▾</span>
              </button>
              <Picker open={panel === "time"}>
                {({ Chip: C }) => (
                  <>
                    <C active={jumpHour === null} onClick={() => pickTime(null)}>
                      Now
                    </C>
                    {hours.map((h) => (
                      <C
                        key={h}
                        active={jumpHour === h}
                        onClick={() => pickTime(h)}
                      >
                        {two(h)}:00{h === 0 ? " · next day" : ""}
                      </C>
                    ))}
                  </>
                )}
              </Picker>
            </div>
          )}

          {destinations.length > 1 && (
            <div className="tool">
              <button className={`tool-btn${panel === "dest" ? " open" : ""}`} onClick={() => toggle("dest")}>
                <span>{destFilter === null ? "All trains" : destFilter}</span>
                <span className="chev">▾</span>
              </button>
              <Picker open={panel === "dest"}>
                {({ Chip: C }) => (
                  <>
                    <C active={destFilter === null} onClick={() => pickDest(null)}>
                      All trains
                    </C>
                    {destinations.map((d) => (
                      <C key={d} active={destFilter === d} onClick={() => pickDest(d)}>
                        {d}
                      </C>
                    ))}
                  </>
                )}
              </Picker>
            </div>
          )}
        </div>
      )}

      <div className="cols">
        <span className="col num">#</span>
        <span className="col time">Time</span>
        <span className="col to">Destination</span>
        <span className="col meta">Status · Plat · Depart</span>
      </div>

      {list.length > 0 && (
        <div className="rowcount">
          {list.length} departure{list.length === 1 ? "" : "s"}
          {truncated ? ` (first ${MAX_ROWS} shown)` : ""}
          {jumpHour !== null ? ` · ${two(jumpHour)}:00–${two(jumpHour + 1)}:00` : " · rest of day"}
        </div>
      )}

      {list.length === 0 && (
        <div className="empty">
          {jumpHour !== null
            ? `No ${destFilter ? destFilter + " " : ""}trains in the ${two(jumpHour)}:00 hour.`
            : `No upcoming trains to ${toName} in the next few hours. Service may have ended for the night.`}
        </div>
      )}

      {list.map((departure, i) => (
        <Row
          key={departure.rid}
          departure={departure}
          index={i}
          toName={toName}
          fastest={showFastest && legs[i] !== null && legs[i] >= 0 && legs[i] === minLeg}
        />
      ))}
    </div>
  );
}

function StationSelect({ label, value, exclude, onChange, options }) {
  return (
    <label className="station-field">
      <span className="s-label">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options
          .filter((s) => s.crs !== exclude)
          .map((s) => (
            <option key={s.crs} value={s.crs}>
              {s.name}
            </option>
          ))}
      </select>
    </label>
  );
}

export default function App() {
  const [fromCrs, setFromCrs] = useState("SNS");
  const [toCrs, setToCrs] = useState("TWI");
  const [jumpHour, setJumpHour] = useState(null);
  const [destFilter, setDestFilter] = useState(null);
  const { boards, loading, error, updatedAt } = useBoards();

  const from = STATIONS.find((s) => s.crs === fromCrs) ?? STATIONS[0];
  const to = STATIONS.find((s) => s.crs === toCrs) ?? STATIONS[1];
  const board = boards?.[`${from.crs}:${to.crs}`] ?? null;

  const pickFrom = (crs) => {
    setFromCrs(crs);
    setJumpHour(null);
    setDestFilter(null);
  };
  const pickTo = (crs) => {
    setToCrs(crs);
    setJumpHour(null);
    setDestFilter(null);
  };
  const swap = () => {
    setFromCrs(toCrs);
    setToCrs(fromCrs);
    setJumpHour(null);
    setDestFilter(null);
  };

  return (
    <div className="app">
      <header>
        <h1>
          <span className="h1a">{from.name}</span>
          <span className="arrow"> → </span>
          <span className="h1b">{to.name}</span>
        </h1>
        <p className="sub">
          All departures · South Western Railway · data refreshes every 30 min
        </p>

        <div className="stations">
          <StationSelect
            label="From"
            value={fromCrs}
            exclude={toCrs}
            onChange={pickFrom}
            options={STATIONS}
          />
          <button className="swap" onClick={swap} aria-label="Swap direction">
            <span aria-hidden="true">⇄</span>
          </button>
          <StationSelect
            label="To"
            value={toCrs}
            exclude={fromCrs}
            onChange={pickTo}
            options={STATIONS}
          />
        </div>
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
          key={`${from.crs}:${to.crs}`}
          data={board}
          toName={to.name}
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