import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const REFRESH_MS = 30000;
const ALARM_KEY = "swr-trains-alarms";
const FIRED_KEY = "swr-trains-fired";
const ALARM_AHEAD_MS = 10 * 60000;
const MAX_ROWS = 200;
const ROLLING_WINDOW_MS = 90 * 60000;

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

function fmtAgo(min) {
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)}h ${two(min % 60)}m`;
}

function statusOf(s) {
  if (s.cancelled) return { label: "Cancelled", className: "cancelled" };
  if (s.status === "Late") return { label: "Late", className: "late" };
  if (s.status === "Delayed") return { label: "Delayed", className: "delayed" };
  if (s.status === "OnTime") return { label: "On time", className: "on-time" };
  return { label: s.status || "—", className: "unknown" };
}

function minsOfDay(t) {
  if (!t) return NaN;
  const d = new Date(t);
  return d.getHours() * 60 + d.getMinutes();
}

function parseHM(str) {
  if (!str) return NaN;
  const m = String(str).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return NaN;
  const h = +m[1];
  const min = +m[2];
  if (h < 0 || h > 23 || min < 0 || min > 59) return NaN;
  return h * 60 + min;
}

function hmFromMin(total) {
  total = ((total % 1440) + 1440) % 1440;
  return `${two(Math.floor(total / 60))}:${two(total % 60)}`;
}

async function loadSnapshot(bust) {
  const url = bust ? `data/departures.json?t=${Date.now()}` : "data/departures.json";
  const res = await fetch(url);
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

  const load = useCallback(async (bust = false) => {
    try {
      let snapshot;
      try {
        snapshot = await loadSnapshot(bust);
      } catch {
        try {
          snapshot = await loadSnapshot(false);
        } catch {
          snapshot = await loadApiFallback();
        }
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
    timer.current = setInterval(() => load(false), REFRESH_MS);
    return () => clearInterval(timer.current);
  }, [load]);

  return { ...state, refresh: () => load(true) };
}

function sortByTime(services) {
  return [...(services ?? [])].sort(
    (a, b) => new Date(a.scheduled).getTime() - new Date(b.scheduled).getTime()
  );
}

function listAlarms() {
  try {
    const a = JSON.parse(localStorage.getItem(ALARM_KEY));
    return Array.isArray(a) ? a.filter((x) => x && x.rid) : [];
  } catch {
    return [];
  }
}

function readFired() {
  try {
    const f = JSON.parse(sessionStorage.getItem(FIRED_KEY));
    return new Set(Array.isArray(f) ? f : []);
  } catch {
    return new Set();
  }
}

function writeFired(s) {
  try {
    sessionStorage.setItem(FIRED_KEY, JSON.stringify([...s]));
  } catch {}
}

async function ensurePermission() {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  const p = Notification.permission;
  if (p === "granted") return "granted";
  if (p === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "denied";
  }
}

function showNotification(title, body) {
  if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body, tag: "swr-alarm" });
      return true;
    } catch {}
  }
  return false;
}

function Row({ departure, index, toName, fastest, alarmed, onToggleAlarm, expanded, onToggle }) {
  const st = statusOf(departure);
  const scheduled = hhmm(departure.scheduled);
  const estimated = hhmm(departure.estimated);
  const delayed =
    departure.estimated &&
    departure.scheduled &&
    effectiveTime(departure) !== new Date(departure.scheduled).getTime();
  const durMs = effectiveTime(departure) - Date.now();
  const countdown = fmtCountdown(durMs);
  const due = durMs > -60000 && durMs <= 60000;
  const wasDue = useRef(due);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (due && !wasDue.current) {
      wasDue.current = true;
      try {
        if (typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate(60);
      } catch {}
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1300);
      return () => clearTimeout(t);
    }
    if (!due) wasDue.current = false;
  }, [due]);

  return (
    <div
      className={`row ${st.className}${due ? " due" : ""}${flash ? " flash" : ""}`}
      onClick={onToggle}
      role="button"
      aria-expanded={expanded}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onToggle();
        }
      }}
    >
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
          {departure.filterArrival ? (
            <>arrives <span className="arrive">{hhmm(departure.filterArrival)}</span></>
          ) : (
            `calls at ${toName}`
          )}
        </span>
      </div>
      <div className="cell meta">
        <span className={`chip ${st.className}`}>{st.label}</span>
        <span className="plat mono">{departure.platform ? `Plat ${departure.platform}` : "—"}</span>
        {!departure.cancelled && <span className="mono countdown">{countdown}</span>}
        <button
          className={`alarm${alarmed ? " on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleAlarm();
          }}
          aria-pressed={alarmed}
          title={alarmed ? "Remove alarm" : "Set an alarm for this train"}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
        </button>
        <span className={`chev-exp${expanded ? " open" : ""}`} aria-hidden="true">▸</span>
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

function buildStops(s, fromCrs, toCrs, fromObj, toObj, ridCache) {
  const fromName = fromObj?.locationName ?? fromCrs;
  const toName = toObj?.locationName ?? toCrs;
  const toArrMs = s.filterArrival ? new Date(s.filterArrival).getTime() : -Infinity;

  const head = [];
  if (s.origin && s.origin !== fromName) head.push({ name: s.origin, kind: "origin", time: null });

  const body = [
    { name: fromName, kind: s.fromIsFirstStop ? "departs · first stop" : "departs", time: s.scheduled, current: true },
  ];
  if (s.filterArrival) {
    body.push({ name: toName, kind: s.toIsLastStop ? "arrives · last stop" : "arrives", time: s.filterArrival });
  }

  const served = ridCache?.get(s.rid);
  if (served) {
    for (const st of STATIONS) {
      if (st.crs === fromCrs || st.crs === toCrs) continue;
      const info = served.get(st.crs);
      if (info?.arrival && new Date(info.arrival).getTime() >= toArrMs) {
        body.push({ name: st.name, kind: info.lastStop ? "arrives · last stop" : "arrives", time: info.arrival });
      }
    }
  }

  body.sort(
    (a, b) => (a.time ? new Date(a.time).getTime() : 0) - (b.time ? new Date(b.time).getTime() : 0)
  );

  const tail = [];
  if (
    s.destination &&
    s.destination !== fromName &&
    s.destination !== toName &&
    !body.some((x) => x.name === s.destination)
  ) {
    tail.push({ name: s.destination, kind: "terminates" });
  }

  return [...head, ...body, ...tail];
}

function StopsPanel({ service, fromCrs, toCrs, from, to, ridCache }) {
  const stops = buildStops(service, fromCrs, toCrs, from, to, ridCache);
  return (
    <div className="stops">
      <div className="stops-title">Calling at</div>
      {stops.map((st, i) => (
        <div className={`stop${st.current ? " current" : ""}`} key={`${st.name}-${i}`}>
          <span className="stop-line" />
          <span className="stop-name">{st.name}</span>
          <span className="stop-kind">{st.kind}</span>
          {st.time && <span className="stop-time mono">{hhmm(st.time)}</span>}
        </div>
      ))}
      {typeof service.intermediateStops === "number" && service.intermediateStops > 0 && (
        <div className="stops-note">
          … plus {service.intermediateStops} further stop{service.intermediateStops === 1 ? "" : "s"} between{" "}
          {from?.locationName} and {to?.locationName}.
        </div>
      )}
    </div>
  );
}

function Board({
  data,
  toName,
  jumpHour,
  setJumpHour,
  destFilter,
  setDestFilter,
  arriveBy,
  setArriveBy,
  alarms,
  toggleAlarm,
  ridCache,
}) {
  const [panel, setPanel] = useState(null); // null | 'time' | 'dest' | 'arrive'
  const [draft, setDraft] = useState("");
  const [expandedRid, setExpandedRid] = useState(null);
  const services = sortByTime(data.services);
  const now = Date.now();
  const genMs = data.generatedAt ? new Date(data.generatedAt).getTime() : NaN;
  const ageMin = Number.isFinite(genMs) ? Math.max(0, Math.round((now - genMs) / 60000)) : null;
  const stale = ageMin !== null && ageMin > 5;
  const halfHour = hmFromMin(new Date(now).getHours() * 60 + new Date(now).getMinutes() + 30);

  const hours = [...new Set(services.map((s) => new Date(s.scheduled).getHours()))].sort((a, b) => a - b);
  const destinations = [...new Set(services.map((s) => s.destination).filter(Boolean))].sort();
  const last = services[services.length - 1] ?? null;

  let base;
  if (arriveBy) {
    const targetMin = parseHM(arriveBy);
    const targetDate = new Date();
    targetDate.setHours(0, 0, 0, 0);
    const targetMs = targetDate.getTime() + Math.min(targetMin, 1439) * 60000;
    base = services.filter(
      (s) =>
        s.filterArrival &&
        new Date(s.filterArrival).getTime() <= targetMs &&
        effectiveTime(s) + 60000 >= now
    );
  } else if (jumpHour !== null) {
    base = services.filter((s) => new Date(s.scheduled).getHours() === jumpHour);
  } else {
    base = services.filter((s) => {
      const t = effectiveTime(s);
      return t + 60000 >= now && t <= now + ROLLING_WINDOW_MS;
    });
  }
  let list = destFilter ? base.filter((s) => s.destination === destFilter) : base;
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
    setArriveBy(null);
    setPanel(null);
  };
  const pickDest = (d) => {
    setDestFilter(d);
    setPanel(null);
  };
  const pickArrive = (t) => {
    setArriveBy(t);
    setJumpHour(null);
    setPanel(null);
    setDraft(t ?? "");
  };
  const applyDraft = () => {
    if (!Number.isNaN(parseHM(draft))) pickArrive(draft);
  };

  const arrivalPresets = ["09:00", "12:00", "17:00", "20:00", "23:59"];

  return (
    <div className="board">
      <div className="board-head">
        <span className="board-title">Departures</span>
        <div className={`updated${stale ? " stale" : ""}`}>
          {data.generatedAt
            ? stale
              ? `Updated ${fmtAgo(ageMin)} ago`
              : `Live board · updated ${hhmm(data.generatedAt)}`
            : "Departures"}
        </div>
      </div>

      {last && (
        <div className="last">
          Last train tonight is the <span className="mono">{hhmm(last.scheduled)}</span> → {last.destination}. Don't miss it!
        </div>
      )}

      {services.length > 0 && (
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

          <div className="tool">
            <button
              className={`tool-btn${panel === "arrive" ? " open" : ""}`}
              onClick={() => {
                setDraft(arriveBy ?? "");
                toggle("arrive");
              }}
            >
              <span>{arriveBy ? `by ${arriveBy}` : "Arrive by"}</span>
              <span className="chev">▾</span>
            </button>
            <Picker open={panel === "arrive"}>
              {({ Chip: C }) => (
                <>
                  <div className="arrive-input">
                    <input
                      type="time"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      aria-label="Arrive by time"
                    />
                    <button className="chip-btn" onClick={applyDraft}>
                      Set
                    </button>
                  </div>
                  <C active={arriveBy === null} onClick={() => pickArrive(null)}>
                    Any time
                  </C>
                  <C active={arriveBy === halfHour} onClick={() => pickArrive(halfHour)}>
                    Now +30m
                  </C>
                  {arrivalPresets.map((t) => (
                    <C key={t} active={arriveBy === t} onClick={() => pickArrive(t)}>
                      {t}
                    </C>
                  ))}
                </>
              )}
            </Picker>
          </div>
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
          {arriveBy
            ? ` · arrive by ${arriveBy}`
            : jumpHour !== null
              ? ` · ${two(jumpHour)}:00–${two(jumpHour + 1)}:00`
              : ` · next 90 min`}
        </div>
      )}

      {list.length === 0 && (
        <div className="empty">
          {arriveBy
            ? `No ${destFilter ? destFilter + " " : ""}trains arrive by ${arriveBy}. Try a later time.`
            : jumpHour !== null
              ? `No ${destFilter ? destFilter + " " : ""}trains in the ${two(jumpHour)}:00 hour.`
              : `No ${destFilter ? destFilter + " " : ""}trains in the next 90 minutes. Try a later hour, or check back soon.`}
        </div>
      )}

      {list.map((departure, i) => (
        <div key={departure.rid} className={`train${expandedRid === departure.rid ? " open" : ""}`}>
          <Row
            departure={departure}
            index={i}
            toName={toName}
            fastest={showFastest && legs[i] !== null && legs[i] >= 0 && legs[i] === minLeg}
            alarmed={alarms.some((a) => a.rid === departure.rid)}
            onToggleAlarm={() => toggleAlarm(departure)}
            expanded={expandedRid === departure.rid}
            onToggle={() => setExpandedRid((cur) => (cur === departure.rid ? null : departure.rid))}
          />
          {expandedRid === departure.rid && (
            <StopsPanel
              service={departure}
              fromCrs={data.departureStation?.crs}
              toCrs={data.filterStation?.crs}
              from={data.departureStation}
              to={data.filterStation}
              ridCache={ridCache}
            />
          )}
        </div>
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
  const [arriveBy, setArriveBy] = useState(null);
  const [alarms, setAlarms] = useState(listAlarms);
  const [toast, setToast] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tick, setTick] = useState(0);
  const [ptr, setPtr] = useState(0);
  const { boards, loading, error, updatedAt, refresh } = useBoards();

  const from = STATIONS.find((s) => s.crs === fromCrs) ?? STATIONS[0];
  const to = STATIONS.find((s) => s.crs === toCrs) ?? STATIONS[1];
  const board = boards?.[`${from.crs}:${to.crs}`] ?? null;

  const ridCache = useMemo(() => {
    const cache = new Map();
    for (const [pairKey, pairBoard] of Object.entries(boards ?? {})) {
      const toCrs = pairKey.split(":")[1];
      for (const s of pairBoard?.services ?? []) {
        if (!s.rid) continue;
        let byRid = cache.get(s.rid);
        if (!byRid) {
          byRid = new Map();
          cache.set(s.rid, byRid);
        }
        const existing = byRid.get(toCrs);
        if (!existing || (s.filterArrival && (!existing.arrival || new Date(s.filterArrival) < new Date(existing.arrival)))) {
          byRid.set(toCrs, { arrival: s.filterArrival ?? null, lastStop: !!s.toIsLastStop });
        }
      }
    }
    return cache;
  }, [boards]);

  const alarmsRef = useRef(alarms);
  alarmsRef.current = alarms;
  const boardsRef = useRef(null);
  boardsRef.current = boards;
  const toRef = useRef(to);
  toRef.current = to;
  const firedRef = useRef(readFired());

  const showToast = useCallback((msg) => setToast({ id: Date.now(), msg }), []);

  useEffect(() => {
    try {
      localStorage.setItem(ALARM_KEY, JSON.stringify(alarms));
    } catch {}
  }, [alarms]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const now = Date.now();
    const svcs = sortByTime(board?.services ?? []);
    const next = svcs.find((s) => !s.cancelled && effectiveTime(s) + 60000 > now) ?? svcs[0] ?? null;
    let title = `${from.crs} → ${to.crs}`;
    if (next) {
      const d = Math.max(0, effectiveTime(next) - now);
      title = `${hhmm(next.scheduled)} ${fmtCountdown(d)} → ${next.destination || to.name}`;
    }
    if (document.title !== title) document.title = title;
  }, [board, tick, from.crs, to.crs, to.name]);

  useEffect(() => {
    const timers = [];
    for (const al of alarmsRef.current) {
      const fireAt = new Date(al.scheduled).getTime();
      const plan = [
        [fireAt - ALARM_AHEAD_MS, "10"],
        [fireAt, "0"],
      ];
      for (const [at, key] of plan) {
        const id = `${al.rid}:${key}`;
        if (at <= Date.now() || firedRef.current.has(id)) continue;
        timers.push(
          setTimeout(() => {
            firedRef.current.add(id);
            writeFired(firedRef.current);
            const route = boardsRef.current?.[al.route]?.services ?? [];
            const s = route.find((x) => x.rid === al.rid);
            const label = s ? statusOf(s).label : "On time";
            const plat = s?.platform || al.platform;
            const dest = al.destination || s?.destination || toRef.current.name;
            const ts = s?.estimated || al.scheduled;
            let body;
            if (s?.cancelled) {
              body = `${hhmm(ts)} ${dest} is cancelled - check alternatives.`;
            } else if (key === "10") {
              body = `Departs in 10 min - ${label.toLowerCase()} - platform ${plat ?? "?"}.`;
            } else {
              body = `Departing now - ${label.toLowerCase()} - platform ${plat ?? "?"}.`;
            }
            const title = `Alarm: ${dest} ${hhmm(ts)}`;
            showNotification(title, body);
            showToast(`${title} · ${body}`);
          }, Math.max(0, at - Date.now()))
        );
      }
    }
    return () => timers.forEach(clearTimeout);
  }, [alarms, showToast]);

  const refreshingRef = useRef(false);
  const doRefreshRef = useRef(null);
  const doRefresh = useCallback(async () => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    await refresh();
    refreshingRef.current = false;
    setRefreshing(false);
  }, [refresh]);
  doRefreshRef.current = doRefresh;

  const pullY = useRef(0);
  useEffect(() => {
    let startY = null;
    let pulling = false;
    const overTop = () => (document.scrollingElement?.scrollTop ?? window.scrollY ?? 0) <= 0;
    const onStart = (e) => {
      if (overTop() && e.touches.length === 1) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    };
    const onMove = (e) => {
      if (!pulling || startY == null) return;
      const dy = e.touches[0].clientY - startY;
      if (dy > 0 && overTop()) {
        e.preventDefault();
        pullY.current = Math.min(110, dy * 0.5);
        setPtr(pullY.current);
      } else if (dy <= 0) {
        pullY.current = 0;
        setPtr(0);
      }
    };
    const onEnd = () => {
      pulling = false;
      startY = null;
      if (pullY.current >= 70) doRefreshRef.current();
      pullY.current = 0;
      setPtr(0);
    };
    document.addEventListener("touchstart", onStart, { passive: true });
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
    return () => {
      document.removeEventListener("touchstart", onStart);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);
    };
  }, []);

  const pickFrom = (crs) => {
    setFromCrs(crs);
    setJumpHour(null);
    setDestFilter(null);
    setArriveBy(null);
  };
  const pickTo = (crs) => {
    setToCrs(crs);
    setJumpHour(null);
    setDestFilter(null);
    setArriveBy(null);
  };
  const swap = () => {
    setFromCrs(toCrs);
    setToCrs(fromCrs);
    setJumpHour(null);
    setDestFilter(null);
    setArriveBy(null);
  };

  const toggleAlarm = (departure) => {
    if (alarms.some((a) => a.rid === departure.rid)) {
      setAlarms((cur) => cur.filter((a) => a.rid !== departure.rid));
      showToast("Alarm removed.");
      return;
    }
    setAlarms((cur) => [
      ...cur,
      {
        rid: departure.rid,
        scheduled: departure.scheduled,
        route: `${from.crs}:${to.crs}`,
        destination: departure.destination ?? to.name,
        toName: to.name,
        platform: departure.platform ?? null,
      },
    ]);
    ensurePermission().then((p) => {
      if (p === "unsupported") {
        showToast(`Alarm set for ${hhmm(departure.scheduled)} - I'll alert you while the app is open.`);
      } else if (p === "denied") {
        showToast(`Alarm set for ${hhmm(departure.scheduled)}, but notifications are blocked - I'll alert you while the app is open.`);
      } else {
        showToast(`Alarm set for ${hhmm(departure.scheduled)} → ${departure.destination ?? to.name}.`);
      }
    });
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
          arriveBy={arriveBy}
          setArriveBy={setArriveBy}
          alarms={alarms}
          toggleAlarm={toggleAlarm}
          ridCache={ridCache}
        />
      )}

      <footer>
        {updatedAt
          ? `Board refreshes every 30s · Data updated by GitHub Actions every 30 min · Last check ${updatedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
          : ""}
        <button className="refbtn" onClick={doRefresh} title="Refresh now" aria-label="Refresh now">
          <span className={refreshing ? "spin" : ""}>⟳</span>
        </button>
      </footer>

      <div
        className={`ptr${ptr > 0 || refreshing ? " show" : ""}`}
        style={{
          transform: `translateY(${refreshing ? 0 : ptr - 50}px)`,
          opacity: refreshing ? 1 : Math.min(1, ptr / 70),
        }}
      >
        <span>{refreshing ? "Refreshing…" : ptr >= 70 ? "Release to refresh" : "Pull to refresh"}</span>
      </div>

      {toast && <div className="toast" key={toast.id}>{toast.msg}</div>}
    </div>
  );
}