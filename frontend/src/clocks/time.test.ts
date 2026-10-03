import { describe, expect, it } from "vitest";
import type { ClockHours } from "../api/types";
import {
  allZones,
  convertWallTime,
  formatDiff,
  fromMinutes,
  homeZone,
  hoursFor,
  inRange,
  newPlaceId,
  readClock,
  searchZones,
  shadeAt,
  toMinutes,
  wallDate,
  wallMinutes,
  zoneCity,
  zoneOffset,
} from "./time";

const HOURS: ClockHours = { work: ["09:00", "18:00"], night: ["23:00", "07:00"] };
const at = (iso: string) => new Date(iso);
const PARIS = "Europe/Paris";
const NY = "America/New_York";

describe("zoneOffset", () => {
  it("handles whole-hour, half-hour and quarter-hour zones", () => {
    const t = at("2026-03-20T12:00:00Z");
    expect(zoneOffset("UTC", t)).toBe(0);
    expect(zoneOffset(PARIS, t)).toBe(60);
    expect(zoneOffset(NY, t)).toBe(-240);
    expect(zoneOffset("Asia/Kolkata", t)).toBe(330);
    expect(zoneOffset("Asia/Kathmandu", t)).toBe(345);
    expect(zoneOffset("Pacific/Apia", t)).toBe(780);
  });

  it("follows Chatham's 45-minute offsets and Lord Howe's 30-minute DST", () => {
    expect(zoneOffset("Pacific/Chatham", at("2026-03-20T12:00:00Z"))).toBe(13 * 60 + 45);
    expect(zoneOffset("Pacific/Chatham", at("2026-06-20T12:00:00Z"))).toBe(12 * 60 + 45);
    expect(zoneOffset("Australia/Lord_Howe", at("2026-01-20T12:00:00Z"))).toBe(11 * 60);
    expect(zoneOffset("Australia/Lord_Howe", at("2026-06-20T12:00:00Z"))).toBe(10 * 60 + 30);
  });

  it("changes on the DST day in each region, not before", () => {
    // US spring forward 2026-03-08 07:00Z; EU 2026-03-29 01:00Z.
    expect(zoneOffset(NY, at("2026-03-08T06:59:00Z"))).toBe(-300);
    expect(zoneOffset(NY, at("2026-03-08T07:00:00Z"))).toBe(-240);
    expect(zoneOffset(PARIS, at("2026-03-29T00:59:00Z"))).toBe(60);
    expect(zoneOffset(PARIS, at("2026-03-29T01:00:00Z"))).toBe(120);
  });

  it("is not thrown by milliseconds", () => {
    expect(zoneOffset(PARIS, at("2026-03-20T12:00:00.999Z"))).toBe(60);
  });

  it("throws RangeError for an unknown zone", () => {
    expect(() => zoneOffset("Mars/Olympus", new Date())).toThrow(RangeError);
  });
});

describe("wallMinutes / wallDate", () => {
  it("reads midnight as 0, never 24:00", () => {
    // 23:00Z in Paris (+1) is 00:00 next day.
    const t = at("2026-03-20T23:00:00Z");
    expect(wallMinutes(PARIS, t)).toBe(0);
    expect(wallDate(PARIS, t)).toBe("2026-03-21");
  });

  it("reads the zone's own date and time", () => {
    const t = at("2026-03-20T12:34:00Z");
    expect(wallMinutes("Asia/Kathmandu", t)).toBe(18 * 60 + 19);
    expect(wallDate(NY, at("2026-03-20T02:00:00Z"))).toBe("2026-03-19");
  });
});

describe("toMinutes / fromMinutes", () => {
  it("round-trips", () => {
    expect(toMinutes("00:00")).toBe(0);
    expect(toMinutes("23:59")).toBe(1439);
    expect(toMinutes("09:15")).toBe(555);
    expect(fromMinutes(555)).toBe("09:15");
    expect(fromMinutes(0)).toBe("00:00");
  });

  it("refuses anything but HH:MM", () => {
    for (const bad of ["9:00", "24:00", "12:60", "12:00:00", "", "ab:cd", "12-00"]) {
      expect(() => toMinutes(bad)).toThrow();
    }
  });

  it("wraps out-of-range minutes", () => {
    expect(fromMinutes(1440)).toBe("00:00");
    expect(fromMinutes(-15)).toBe("23:45");
  });
});

describe("inRange / shadeAt", () => {
  it("is [start, end)", () => {
    expect(inRange(["09:00", "18:00"], toMinutes("09:00"))).toBe(true);
    expect(inRange(["09:00", "18:00"], toMinutes("17:59"))).toBe(true);
    expect(inRange(["09:00", "18:00"], toMinutes("18:00"))).toBe(false);
    expect(inRange(["09:00", "18:00"], toMinutes("08:59"))).toBe(false);
  });

  it("wraps past midnight when end <= start", () => {
    const night: [string, string] = ["23:00", "07:00"];
    expect(inRange(night, toMinutes("23:00"))).toBe(true);
    expect(inRange(night, toMinutes("00:00"))).toBe(true);
    expect(inRange(night, toMinutes("06:59"))).toBe(true);
    expect(inRange(night, toMinutes("07:00"))).toBe(false);
    expect(inRange(night, toMinutes("12:00"))).toBe(false);
  });

  it("is empty when start === end", () => {
    for (const m of [0, 540, 1439]) expect(inRange(["09:00", "09:00"], m)).toBe(false);
  });

  it("lets night win over work", () => {
    const overlap: ClockHours = { work: ["06:00", "18:00"], night: ["23:00", "07:00"] };
    expect(shadeAt(overlap, toMinutes("06:30"))).toBe("night");
    expect(shadeAt(overlap, toMinutes("07:00"))).toBe("work");
    expect(shadeAt(HOURS, toMinutes("12:00"))).toBe("work");
    expect(shadeAt(HOURS, toMinutes("20:00"))).toBe("free");
    expect(shadeAt(HOURS, toMinutes("03:00"))).toBe("night");
  });

  it("hoursFor prefers the place's own", () => {
    const own: ClockHours = { work: ["10:00", "12:00"], night: ["00:00", "01:00"] };
    expect(hoursFor({ hours: own }, HOURS)).toBe(own);
    expect(hoursFor({ hours: null }, HOURS)).toBe(HOURS);
  });
});

describe("readClock", () => {
  it("Paris minus New York is 5h in the weeks the DSTs disagree, 6h otherwise", () => {
    const diffAt = (iso: string) => readClock(PARIS, at(iso), NY, HOURS).diff;
    expect(diffAt("2026-03-05T12:00:00Z")).toBe(360);
    expect(diffAt("2026-03-20T12:00:00Z")).toBe(300);
    expect(diffAt("2026-04-05T12:00:00Z")).toBe(360);
    // And the autumn weeks: EU ends 2026-10-25, US 2026-11-01.
    expect(diffAt("2026-10-28T12:00:00Z")).toBe(300);
  });

  it("reports time, diff and shade", () => {
    const r = readClock("Asia/Kolkata", at("2026-03-20T12:00:00Z"), PARIS, HOURS);
    expect(r).toEqual({ time: "17:30", dayShift: 0, diff: 270, shade: "work" });
  });

  it("shifts the day across midnight", () => {
    const t = at("2026-03-20T22:30:00Z");
    expect(readClock("Asia/Tokyo", t, "UTC", HOURS).dayShift).toBe(1);
    expect(readClock("America/Los_Angeles", t, "UTC", HOURS).dayShift).toBe(0);
    expect(readClock("America/Los_Angeles", at("2026-03-20T05:00:00Z"), "UTC", HOURS).dayShift).toBe(-1);
  });

  it("shifts the day across the date line", () => {
    const t = at("2026-03-20T12:00:00Z");
    const kiri = readClock("Pacific/Kiritimati", t, "Pacific/Pago_Pago", HOURS);
    expect(kiri.dayShift).toBe(1);
    expect(kiri.diff).toBe(25 * 60);
    expect(kiri.time).toBe("02:00");
    const pago = readClock("Pacific/Pago_Pago", t, "Pacific/Kiritimati", HOURS);
    expect(pago.dayShift).toBe(-1);
    expect(pago.diff).toBe(-25 * 60);
  });

  it("is same-day, zero diff for the home zone", () => {
    const r = readClock(PARIS, at("2026-03-20T12:00:00Z"), PARIS, HOURS);
    expect(r.dayShift).toBe(0);
    expect(r.diff).toBe(0);
  });
});

describe("formatDiff", () => {
  it("formats with a real minus sign", () => {
    expect(formatDiff(60)).toBe("+1h");
    expect(formatDiff(-450)).toBe("−7h30");
    expect(formatDiff(345)).toBe("+5h45");
    expect(formatDiff(-60)).toBe("−1h");
    expect(formatDiff(1500)).toBe("+25h");
    expect(formatDiff(30)).toBe("+0h30");
  });
  it("is null for no difference", () => {
    expect(formatDiff(0)).toBeNull();
  });
});

describe("homeZone", () => {
  it("prefers the account's zone, else the device's, else UTC", () => {
    expect(homeZone({ timezone: "Asia/Tokyo" })).toBe("Asia/Tokyo");
    expect(homeZone(null)).toBe(new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    expect(homeZone({ timezone: null })).toBe(
      new Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    );
  });
});

describe("zoneCity", () => {
  it("takes the last segment and un-underscores it", () => {
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
    expect(zoneCity("Europe/Paris")).toBe("Paris");
    expect(zoneCity("UTC")).toBe("UTC");
  });
});

describe("allZones", () => {
  it("is sorted, unique and has UTC", () => {
    const z = allZones();
    expect(z).toContain("UTC");
    expect(z).toContain(PARIS);
    expect(z).toEqual([...new Set(z)].sort());
  });
});

describe("searchZones", () => {
  const zones = [
    "America/Sao_Paulo",
    "Europe/Paris",
    "America/New_York",
    "America/Argentina/Buenos_Aires",
    "Asia/Kolkata",
    "Europe/Parma",
    "Pacific/Noumea",
    "America/Paramaribo",
    "UTC",
  ];

  it("ignores accents and case", () => {
    expect(searchZones("sao", zones)).toEqual(["America/Sao_Paulo"]);
    expect(searchZones("SÃO", zones)).toEqual(["America/Sao_Paulo"]);
    expect(searchZones("Nouméa", zones)).toEqual(["Pacific/Noumea"]);
  });

  it("treats spaces, underscores and slashes as equal", () => {
    expect(searchZones("new york", zones)).toEqual(["America/New_York"]);
    expect(searchZones("new_york", zones)).toEqual(["America/New_York"]);
    expect(searchZones("america new york", zones)).toEqual(["America/New_York"]);
    expect(searchZones("america/new", zones)).toEqual(["America/New_York"]);
    expect(searchZones("buenos aires", zones)).toEqual(["America/Argentina/Buenos_Aires"]);
  });

  it("puts city-prefix matches before other matches, each alphabetical", () => {
    // "par": Paramaribo, Parma, Paris by city prefix; Sao_Paulo/Europe don't contain "par".
    expect(searchZones("par", zones)).toEqual([
      "America/Paramaribo",
      "Europe/Parma",
      "Europe/Paris",
    ].sort());
    // "a" - city prefixes (Asia? no: city Kolkata no) ... check ordering with a substring case.
    const mixed = ["Europe/Zed", "Asia/Aden", "Africa/Amed", "Zed/Other"];
    // "ame": city-prefix Africa/Amed; id-substring "America..." not present.
    expect(searchZones("ame", [...mixed, "America/Zzz", "Pacific/Ame", "Asia/Xame"])).toEqual([
      "Africa/Amed",
      "Pacific/Ame",
      "America/Zzz",
      "Asia/Xame",
    ]);
  });

  it("caps at limit", () => {
    expect(searchZones("a", zones, 2)).toHaveLength(2);
    expect(searchZones("a", zones)).not.toHaveLength(0);
  });

  it("returns nothing for an empty query", () => {
    expect(searchZones("  ", zones)).toEqual([]);
  });
});

describe("convertWallTime", () => {
  it("converts an ordinary time and carries the day", () => {
    expect(convertWallTime("2026-03-20", "13:00", "UTC", PARIS)).toEqual({
      time: "14:00",
      dayShift: 0,
    });
    expect(convertWallTime("2026-03-20", "23:30", "UTC", "Asia/Tokyo")).toEqual({
      time: "08:30",
      dayShift: 1,
    });
    expect(convertWallTime("2026-03-20", "01:00", "UTC", NY)).toEqual({
      time: "21:00",
      dayShift: -1,
    });
  });

  it("uses the DST in force on that date", () => {
    expect(convertWallTime("2026-03-20", "12:00", PARIS, NY).time).toBe("07:00");
    expect(convertWallTime("2026-03-05", "12:00", PARIS, NY).time).toBe("06:00");
  });

  it("reads a spring-forward gap with the offset before the gap", () => {
    // 02:30 on 2026-03-29 does not exist in Paris; +01:00 gives 01:30Z.
    expect(convertWallTime("2026-03-29", "02:30", PARIS, "UTC")).toEqual({
      time: "01:30",
      dayShift: 0,
    });
  });

  it("takes the first occurrence of a fall-back overlap", () => {
    // 02:30 on 2026-10-25 happens twice in Paris; first is +02:00 = 00:30Z.
    expect(convertWallTime("2026-10-25", "02:30", PARIS, "UTC")).toEqual({
      time: "00:30",
      dayShift: 0,
    });
  });

  it("handles a zone behind UTC with a gap too", () => {
    // US gap 2026-03-08 02:30 NY: offset before is -05:00 → 07:30Z.
    expect(convertWallTime("2026-03-08", "02:30", NY, "UTC").time).toBe("07:30");
  });

  it("handles quarter-hour zones", () => {
    expect(convertWallTime("2026-03-20", "12:00", "UTC", "Asia/Kathmandu").time).toBe("17:45");
  });
});

describe("newPlaceId", () => {
  it("matches the server's pattern and is fresh each time", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const id = newPlaceId();
      expect(id).toMatch(/^[A-Za-z0-9_-]{1,40}$/);
      ids.add(id);
    }
    expect(ids.size).toBe(50);
  });
});
