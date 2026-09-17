export const API_URL = "https://nreservices.nationalrail.co.uk/live-info";

const BOARD_RESULT = `
fragment boardResult on NreStationBoard {
    generatedAt
    nrccMessages {
      message
      severity
    }
    departureStation {
      locationName
      crs
      via
    }
    filterStation {
      locationName
      crs
      via
    }
    services {
      rid
      trainUid
      serviceType {
        mode
        category
      }
      origin {
        locationName
        crs
        via
      }
      destination {
        locationName
        crs
        via
      }
      journeyDetails {
        from {
          locationName
          crs
          via
          forecastType
          isFirstStop
          isLastStop
        }
        to {
          locationName
          crs
          via
          forecastType
          isFirstStop
          isLastStop
        }
        stops
        departureInfo {
          scheduled
          estimated
          actual
        }
        arrivalInfo {
          scheduled
          estimated
          actual
        }
      }
      operator {
        name
        code
      }
      status {
        status
        cancel {
          description
          near
          stationName
        }
        delay {
          description
          near
          stationName
        }
        diversion {
          divertedVia
          reason {
            description
            near
            stationName
          }
        }
        uncertainty {
          status
          reason {
            description
            near
            stationName
          }
        }
      }
      departureInfo {
        scheduled
        estimated
        actual
      }
      arrivalInfo {
        scheduled
        estimated
        actual
      }
      platform
      loadingLevel
      isCancelled
      filterLocationCancelled
    }
  }
`;

export const QUERY = `
query DepartureBoard(
  $crs: String!
  $toCrs: String
  $time: String
  $serviceTypes: [NreServiceMode]
  $timeWindow: Int
  $numRows: Int
) {
  DepartureBoard(
    crs: $crs
    toCrs: $toCrs
    time: $time
    serviceTypes: $serviceTypes
    timeWindow: $timeWindow
    numRows: $numRows
  ) {
    ...boardResult
  }
}
${BOARD_RESULT}
`;

const serviceTypes = ["Train", "Bus", "Ferry"];

export async function fetchBoard(crs, toCrs, time) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      accept: "application/json",
      origin: "https://www.nationalrail.co.uk",
      "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    },
    body: JSON.stringify({
      operationName: "DepartureBoard",
      query: QUERY,
      variables: {
        crs,
        toCrs,
        time,
        serviceTypes,
        timeWindow: 120,
        numRows: 10,
      },
    }),
  });

  if (!res.ok) throw new Error(`NRE upstream responded ${res.status}`);
  const payload = await res.json();
  if (payload.errors) throw new Error(payload.errors.map((e) => e.message).join("; "));
  return payload.data.DepartureBoard;
}

function nextWindowTime(services) {
  const times = services
    .map((s) => s.departureInfo?.scheduled)
    .filter(Boolean)
    .sort();
  if (times.length === 0) return null;
  const last = new Date(times[times.length - 1]);
  return new Date(last.getTime() + 60000).toJSON();
}

function normalize(board) {
  return (board?.services ?? []).map((s) => ({
    rid: s.rid,
    origin: s.origin?.[0]?.locationName ?? null,
    destination: s.destination?.[0]?.locationName ?? null,
    via: s.journeyDetails?.to?.callingPoint ?? null,
    scheduled: s.departureInfo?.scheduled ?? null,
    estimated: s.departureInfo?.estimated ?? null,
    actual: s.departureInfo?.actual ?? null,
    platform: s.platform ?? null,
    status: s.status?.status ?? "Unknown",
    cancelled: !!s.isCancelled,
    operator: s.operator?.name ?? null,
    filterArrivalScheduled: s.journeyDetails?.arrivalInfo?.scheduled ?? null,
    filterArrival: s.journeyDetails?.arrivalInfo?.estimated ?? s.journeyDetails?.arrivalInfo?.scheduled ?? null,
    intermediateStops: s.journeyDetails?.stops ?? null,
    fromIsFirstStop: s.journeyDetails?.from?.isFirstStop ?? false,
    toIsLastStop: s.journeyDetails?.to?.isLastStop ?? false,
  }));
}

export async function collectDepartures(crs, toCrs, count) {
  const pages = [];
  let time = new Date().toJSON();
  const seen = new Set();
  const services = [];

  for (let i = 0; i < 8 && services.length < count; i++) {
    const board = await fetchBoard(crs, toCrs, time);
    const row = board ?? { departureStation: null, filterStation: null, services: [] };
    for (const s of row.services ?? []) {
      if (!seen.has(s.rid)) {
        seen.add(s.rid);
        services.push(s);
      }
    }
    const next = nextWindowTime(row.services ?? []);
    if (!next) break;
    time = next;
    if (i === 0) pages.push(row);
  }

  return {
    generatedAt: pages[0]?.generatedAt ?? null,
    departureStation: pages[0]?.departureStation ?? null,
    filterStation: pages[0]?.filterStation ?? null,
    services: normalize({ services }).slice(0, count),
  };
}

export async function collectDay(crs, toCrs, cap = 200, maxPages = 26) {
  const collected = [];
  const seen = new Set();
  let stationInfo = null;
  let time = new Date().toJSON();
  let emptyStrikes = 0;
  let prevTime = null;

  for (let i = 0; i < maxPages && collected.length < cap; i++) {
    const board = await fetchBoard(crs, toCrs, time);
    const row = board ?? { departureStation: null, filterStation: null, services: [] };
    stationInfo = stationInfo ?? row;

    const rows = row.services ?? [];
    for (const s of rows) {
      if (!seen.has(s.rid)) {
        seen.add(s.rid);
        collected.push(s);
      }
    }

    const times = rows.map((r) => r.departureInfo?.scheduled).filter(Boolean).sort();
    const last = times[times.length - 1];

    if (!last) {
      emptyStrikes++;
      if (emptyStrikes > 3) break; // gap between last train and next morning's service
      const jump = new Date(new Date(time).getTime() + 2 * 3600000);
      if (jump - new Date() > 18 * 3600000) break; // sanity: don't probe past the day
      time = jump.toJSON();
      continue;
    }

    emptyStrikes = 0;
    const next = new Date(new Date(last).getTime() + 60000).toJSON();
    if (next === prevTime) break; // no forward progress
    prevTime = next;
    time = next;
  }

  return {
    generatedAt: stationInfo?.generatedAt ?? null,
    departureStation: stationInfo?.departureStation ?? null,
    filterStation: stationInfo?.filterStation ?? null,
    services: normalize({ services: collected }),
  };
}