import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ClockHours } from "../api/types";
import { allZones, findZones, placeAliases, searchZones } from "./search";
import {
  canonicalZone,
  convertWallTime,
  formatDiff,
  fromMinutes,
  homeZone,
  hoursFor,
  inRange,
  newPlaceId,
  readClock,
  sameZone,
  shadeAt,
  toMinutes,
  wallDate,
  wallMinutes,
  zoneCity,
  zoneHint,
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

describe("readClock with a reference instant", () => {
  it("counts the day word from the reference, not from the shifted instant", () => {
    const now = at("2026-03-20T12:00:00Z"); // Paris and Los Angeles are both on the 20th
    const shifted = at("2026-03-21T00:00:00Z"); // 12 h on: Paris is the 21st, LA still the 20th
    expect(readClock("America/Los_Angeles", shifted, PARIS, HOURS).dayShift).toBe(-1);
    expect(readClock("America/Los_Angeles", shifted, PARIS, HOURS, now).dayShift).toBe(0);
    expect(readClock(PARIS, shifted, PARIS, HOURS, now).dayShift).toBe(1);
  });
});

describe("formatDiff", () => {
  it("formats with a real minus sign", () => {
    expect(formatDiff(60)).toBe("+1h");
    expect(formatDiff(-450)).toBe("−7h30");
    expect(formatDiff(345)).toBe("+5h45");
    expect(formatDiff(-60)).toBe("−1h");
    expect(formatDiff(1500)).toBe("+25h");
    expect(formatDiff(60 + 15)).toBe("+1h15");
  });
  it("says minutes under an hour", () => {
    expect(formatDiff(15)).toBe("+15 min");
    expect(formatDiff(-30)).toBe("−30 min");
    expect(formatDiff(59)).toBe("+59 min");
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
  it("names a legacy id after its current one", () => {
    expect(zoneCity("Asia/Calcutta")).toBe("Kolkata");
    expect(zoneCity("Europe/Kiev")).toBe("Kyiv");
    expect(zoneHint("Mum", "Asia/Calcutta")).toBe("Kolkata");
    expect(zoneHint("kolkata", "Asia/Calcutta")).toBeNull();
  });
});

describe("zoneHint / sameZone", () => {
  it("drops the city when the name already says it, whatever the case", () => {
    expect(zoneHint("paris", PARIS)).toBeNull();
    expect(zoneHint(" Paris ", PARIS)).toBeNull();
    expect(zoneHint("Mum", PARIS)).toBe("Paris");
  });
  it("treats a legacy spelling as the same zone", () => {
    expect(sameZone("Asia/Calcutta", "Asia/Kolkata")).toBe(true);
    expect(sameZone("Asia/Kolkata", PARIS)).toBe(false);
  });
});

describe("canonicalZone", () => {
  it("maps legacy ids to the current one and leaves the rest alone", () => {
    expect(canonicalZone("Asia/Calcutta")).toBe("Asia/Kolkata");
    expect(canonicalZone("Europe/Kiev")).toBe("Europe/Kyiv");
    expect(canonicalZone("America/Buenos_Aires")).toBe("America/Argentina/Buenos_Aires");
    expect(canonicalZone("America/Indianapolis")).toBe("America/Indiana/Indianapolis");
    expect(canonicalZone("Europe/Paris")).toBe("Europe/Paris");
    expect(canonicalZone("UTC")).toBe("UTC");
  });
  it("only ever returns an id this engine accepts", () => {
    for (const legacy of ["Asia/Calcutta", "Asia/Katmandu", "Asia/Saigon", "Asia/Rangoon", "America/Godthab", "Pacific/Enderbury", "Pacific/Truk", "Pacific/Ponape", "Atlantic/Faeroe", "America/Louisville"]) {
      expect(() => new Intl.DateTimeFormat("en", { timeZone: canonicalZone(legacy) })).not.toThrow();
    }
  });
});

describe("allZones", () => {
  it("lists no legacy name", () => {
    const z = allZones();
    for (const legacy of ["Asia/Calcutta", "Europe/Kiev", "Asia/Katmandu", "Asia/Saigon"]) {
      expect(z).not.toContain(legacy);
    }
    expect(z).toContain("Asia/Kolkata");
  });
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

  it("finds a zone by its legacy spelling", () => {
    expect(searchZones("calcutta", zones)).toEqual(["Asia/Kolkata"]);
    expect(searchZones("asia/calc", zones)).toEqual(["Asia/Kolkata"]);
  });

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
    // Asia/Xame has it mid-word, which no longer matches.
    expect(searchZones("ame", [...mixed, "America/Zzz", "Pacific/Ame", "Asia/Xame"])).toEqual([
      "Africa/Amed",
      "Pacific/Ame",
      "America/Zzz",
    ]);
  });

  it("caps at limit", () => {
    expect(searchZones("pa", zones, 2)).toHaveLength(2);
    expect(searchZones("pa", zones)).not.toHaveLength(0);
  });

  it("returns nothing for an empty query", () => {
    expect(searchZones("  ", zones)).toEqual([]);
  });

  it("ignores dots and apostrophes", () => {
    const z = ["America/St_Johns", "Europe/Paris"];
    expect(searchZones("st. john's", z)).toEqual(["America/St_Johns"]);
    expect(searchZones("st john’s", z)).toEqual(["America/St_Johns"]);
  });
});

describe("search matches word starts only (round 3)", () => {
  const zones = allZones();

  it("does not find a zone by the middle of a word: usa is not Lusaka, Jerusalem or Busan", () => {
    const found = searchZones("usa", zones, 50);
    for (const wrong of ["Africa/Lusaka", "Asia/Jerusalem", "Asia/Seoul"]) {
      expect(found).not.toContain(wrong);
    }
    expect(searchZones("sak", zones, 50)).not.toContain("Africa/Lusaka");
    expect(searchZones("lusa", zones)).toContain("Africa/Lusaka");
  });

  it("still finds the start of a later word, after a space, a slash, an underscore or a hyphen", () => {
    expect(searchZones("york", zones)).toContain("America/New_York");
    expect(searchZones("aires", zones)).toContain("America/Argentina/Buenos_Aires");
    expect(searchZones("prince", zones)).toContain("America/Port-au-Prince");
    expect(searchZones("argentina/b", zones)).toContain("America/Argentina/Buenos_Aires");
  });

  it("lists a multi-zone country as its main cities, in order, named after the country", () => {
    for (const name of ["usa", "USA", "United States", "us", "america", "Etats-Unis"]) {
      const { matches } = findZones(name, zones, 20);
      expect(matches.slice(0, 6).map((m) => m.zone), name).toEqual([
        "America/New_York",
        "America/Chicago",
        "America/Denver",
        "America/Los_Angeles",
        "America/Anchorage",
        "Pacific/Honolulu",
      ]);
      expect(matches[0]?.alias, name).toBe("United States");
    }
  });

  it("does the same for Canada, Australia, Brazil, Russia, Mexico and Indonesia", () => {
    const first = (q: string) => findZones(q, zones, 20).matches.map((m) => m.zone);
    expect(first("canada").slice(0, 3)).toEqual(["America/Toronto", "America/Winnipeg", "America/Edmonton"]);
    expect(first("australia")).toContain("Australia/Perth");
    expect(first("brazil")).toEqual(
      expect.arrayContaining(["America/Sao_Paulo", "America/Manaus"]),
    );
    expect(first("russia")).toEqual(expect.arrayContaining(["Europe/Moscow", "Asia/Vladivostok"]));
    expect(first("mexico").slice(0, 2)).toEqual(["America/Mexico_City", "America/Cancun"]);
    expect(first("indonesia")).toEqual(["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"]);
  });

  it("knows Hawaii, Iceland and Munchen/München, accents folded on the alias too", () => {
    const one = (q: string) => findZones(q, zones, 5).matches[0];
    expect(one("hawaii")).toEqual({ zone: "Pacific/Honolulu", alias: "Hawaii" });
    expect(one("iceland")).toEqual({ zone: "Atlantic/Reykjavik", alias: "Iceland" });
    for (const q of ["munchen", "München", "MÜNCHEN", "munc"]) {
      expect(one(q), q).toEqual({ zone: "Europe/Berlin", alias: expect.stringMatching(/^M[uü]nchen$/) });
    }
    expect(searchZones("Brésil", zones)).toContain("America/Sao_Paulo");
  });
});

describe("city display names (round 3)", () => {
  it("gives the ids that need it their accents and punctuation", () => {
    expect(zoneCity("America/St_Johns")).toBe("St. John's");
    expect(zoneCity("America/Sao_Paulo")).toBe("São Paulo");
    expect(zoneCity("Europe/Zurich")).toBe("Zürich");
    expect(zoneCity("America/Bogota")).toBe("Bogotá");
    expect(zoneCity("Africa/Ndjamena")).toBe("N’Djamena");
    expect(zoneCity("Europe/Paris")).toBe("Paris");
  });
  it("does not repeat the city when the name only differs by accents or punctuation", () => {
    expect(zoneHint("Zurich", "Europe/Zurich")).toBeNull();
    expect(zoneHint("Zürich", "Europe/Zurich")).toBeNull();
    expect(zoneHint("Sao Paulo", "America/Sao_Paulo")).toBeNull();
    expect(zoneHint("São Paulo", "America/Sao_Paulo")).toBeNull();
    expect(zoneHint("St Johns", "America/St_Johns")).toBeNull();
    expect(zoneHint("St. John's", "America/St_Johns")).toBeNull();
    expect(zoneHint("Mum", "America/Sao_Paulo")).toBe("São Paulo");
  });
});

describe("findZones", () => {
  const zones = allZones();

  it("finds a city by its place alias and says which name matched", () => {
    expect(findZones("delhi", zones).matches).toEqual([{ zone: "Asia/Kolkata", alias: "Delhi" }]);
    expect(findZones("Bombay", zones).matches).toEqual([{ zone: "Asia/Kolkata", alias: "Bombay" }]);
    expect(findZones("san fran", zones).matches).toEqual([
      { zone: "America/Los_Angeles", alias: "San Francisco" },
    ]);
    expect(findZones("washington", zones).matches).toEqual([
      { zone: "America/New_York", alias: "Washington DC" },
    ]);
    expect(findZones("montréal", zones).matches).toEqual([
      { zone: "America/Toronto", alias: "Montreal" },
    ]);
    expect(findZones("gmt", zones).matches[0]).toEqual({ zone: "UTC", alias: "GMT" });
  });

  it("puts a zone's own city before an alias match, and lists a zone once", () => {
    const found = findZones("kolkata", zones).matches;
    expect(found).toEqual([{ zone: "Asia/Kolkata", alias: null }]);
    const mo = findZones("mo", zones).matches.map((m) => m.zone);
    expect(new Set(mo).size).toBe(mo.length);
  });

  it("names the legacy city as the alias", () => {
    expect(findZones("calcutta", zones).matches).toEqual([
      { zone: "Asia/Kolkata", alias: "Calcutta" },
    ]);
  });

  it("counts every match before the cut", () => {
    const { matches, total } = findZones("am", zones, 20);
    expect(matches).toHaveLength(20);
    expect(total).toBeGreaterThan(20);
    expect(findZones("delhi", zones).total).toBe(1);
  });

  it("maps every alias to a zone this engine knows, under its current name", () => {
    for (const [name, zone] of Object.entries(placeAliases)) {
      expect(canonicalZone(zone), name).toBe(zone);
      expect(zones, name).toContain(zone);
    }
    expect(Object.keys(placeAliases).length).toBeGreaterThanOrEqual(60);
    // No ambiguous abbreviations.
    for (const abbreviation of ["PST", "EST", "CET", "IST", "CST", "BST"]) {
      expect(Object.keys(placeAliases)).not.toContain(abbreviation);
    }
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

describe("search ranking and coverage (round 4)", () => {
  const zones = allZones();

  it("needs two characters: one letter finds nothing", () => {
    expect(searchZones("a", zones)).toEqual([]);
    expect(searchZones(" é ", zones)).toEqual([]);
    expect(searchZones("ab", zones).length).toBeGreaterThan(0);
  });

  it("puts an exact alias first, before word-start matches of ids and cities", () => {
    expect(findZones("india", zones).matches[0]).toEqual({ zone: "Asia/Kolkata", alias: "India" });
    expect(findZones("rio", zones).matches[0]).toEqual({ zone: "America/Sao_Paulo", alias: "Rio" });
    // The word-start matches are still there, after it.
    expect(searchZones("india", zones)).toContain("America/Indiana/Indianapolis");
    expect(searchZones("rio", zones)).toContain("America/Rio_Branco");
  });

  it("knows these countries, regions and short names, each first for its exact name", () => {
    const table: [string, string][] = [
      ["Sweden", "Europe/Stockholm"],
      ["Poland", "Europe/Warsaw"],
      ["Deutschland", "Europe/Berlin"],
      ["Germany", "Europe/Berlin"],
      ["Britain", "Europe/London"],
      ["Great Britain", "Europe/London"],
      ["Arizona", "America/Phoenix"],
      ["Alaska", "America/Anchorage"],
      ["Texas", "America/Chicago"],
      ["Florida", "America/New_York"],
      ["NZ", "Pacific/Auckland"],
      ["New Zealand", "Pacific/Auckland"],
      ["NYC", "America/New_York"],
      ["LA", "America/Los_Angeles"],
      ["Norway", "Europe/Oslo"],
      ["Denmark", "Europe/Copenhagen"],
      ["Finland", "Europe/Helsinki"],
      ["Netherlands", "Europe/Amsterdam"],
      ["Holland", "Europe/Amsterdam"],
      ["Belgium", "Europe/Brussels"],
      ["Switzerland", "Europe/Zurich"],
      ["Austria", "Europe/Vienna"],
      ["Portugal", "Europe/Lisbon"],
      ["Turkey", "Europe/Istanbul"],
      ["Egypt", "Africa/Cairo"],
      ["Nigeria", "Africa/Lagos"],
      ["Kenya", "Africa/Nairobi"],
      ["South Africa", "Africa/Johannesburg"],
      ["Korea", "Asia/Seoul"],
      ["South Korea", "Asia/Seoul"],
      ["Thailand", "Asia/Bangkok"],
      ["Vietnam", "Asia/Ho_Chi_Minh"],
      ["Philippines", "Asia/Manila"],
      ["Singapore", "Asia/Singapore"],
      ["Malaysia", "Asia/Kuala_Lumpur"],
      ["Pakistan", "Asia/Karachi"],
      ["Saudi Arabia", "Asia/Riyadh"],
      ["UAE", "Asia/Dubai"],
      ["Israel", "Asia/Jerusalem"],
      ["Chile", "America/Santiago"],
      ["Colombia", "America/Bogota"],
      ["Peru", "America/Lima"],
    ];
    for (const [name, zone] of table) {
      expect(searchZones(name.toLowerCase(), zones)[0], name).toBe(zone);
    }
  });

  it("has no typo tolerance", () => {
    expect(searchZones("swedn", zones)).toEqual([]);
  });
});

describe("region links (round 4)", () => {
  it("maps US/*, Canada/* and the UTC spellings to the current zone", () => {
    expect(canonicalZone("US/Eastern")).toBe("America/New_York");
    expect(canonicalZone("US/Pacific")).toBe("America/Los_Angeles");
    expect(canonicalZone("US/Hawaii")).toBe("Pacific/Honolulu");
    expect(canonicalZone("Canada/Pacific")).toBe("America/Vancouver");
    expect(canonicalZone("Canada/Newfoundland")).toBe("America/St_Johns");
    for (const utc of ["Etc/UTC", "GMT", "Universal", "Zulu", "Etc/GMT", "UCT"]) {
      expect(canonicalZone(utc), utc).toBe("UTC");
    }
    expect(sameZone("US/Eastern", "America/New_York")).toBe(true);
  });

  it("does not turn a region link into a search alias", () => {
    // "Eastern" or "Pacific" name several places; neither finds New York or Los Angeles.
    expect(findZones("eastern", allZones()).matches.some((m) => m.alias === "Eastern")).toBe(false);
    expect(findZones("pacific", allZones()).matches.some((m) => m.zone === "America/Los_Angeles")).toBe(false);
  });
});

describe("borough aliases and 'in' ordering (round 5)", () => {
  const zones = allZones();

  it("finds New York by its boroughs", () => {
    for (const name of ["Brooklyn", "Queens", "Manhattan", "Bronx", "Staten Island"]) {
      expect(findZones(name, zones).matches[0], name).toEqual({
        zone: "America/New_York",
        alias: name,
      });
    }
  });

  it("lists country and alias prefixes by name length, then alphabetically: India before Indonesia", () => {
    const found = findZones("in", zones, 50).matches;
    const india = found.findIndex((m) => m.alias === "India");
    const indonesia = found.findIndex((m) => m.alias === "Indonesia");
    expect(india).toBeGreaterThan(-1);
    expect(indonesia).toBeGreaterThan(-1);
    expect(india).toBeLessThan(indonesia);
    // Indonesia's own zones stay together, in their fixed order.
    const id = found.filter((m) => m.alias === "Indonesia").map((m) => m.zone);
    expect(id).toEqual(["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"]);
    expect(found.slice(indonesia, indonesia + 3).map((m) => m.zone)).toEqual(id);
  });
});

describe("the main bundle stays light (Epic 52 round 1)", () => {
  const source = (file: string) => readFileSync(join(__dirname, file), "utf8");

  it("keeps the alias and country tables out of time.ts, which the navigation hints import", () => {
    const time = source("time.ts");
    for (const heavy of ["PLACE_ALIASES", "COUNTRIES", "findZones", "FALLBACK_ZONES", "CITY_NAMES", "Asia/Calcutta"])
      expect(time).not.toContain(heavy);
    expect(source("search.ts")).toContain("const PLACE_ALIASES");
    expect(source("zones.ts")).toContain("LEGACY_ZONES");
  });

  it("has nothing in the shell import the search", () => {
    for (const file of ["../nav/hints.ts", "../App.tsx", "../components/nav/Sidebar.tsx"])
      expect(source(file)).not.toContain("clocks/search");
  });
});
