import { describe, expect, it } from "vitest";

import { hemisphereFromZone, resolveHemisphere } from "./hemisphere";

describe("hemisphereFromZone", () => {
  const table: [string | null | undefined, "north" | "south"][] = [
    ["Australia/Sydney", "south"],
    ["Australia/Perth", "south"],
    ["Australia/Darwin", "south"],
    ["Pacific/Auckland", "south"],
    ["America/Argentina/Buenos_Aires", "south"],
    ["America/Buenos_Aires", "south"],
    ["America/Santiago", "south"],
    ["America/Sao_Paulo", "south"],
    ["Africa/Johannesburg", "south"],
    ["Antarctica/McMurdo", "south"],
    ["Pacific/Fiji", "south"],
    ["Africa/Brazzaville", "south"],
    ["Indian/Mahe", "south"],
    ["Pacific/Kanton", "south"],
    ["Pacific/Nauru", "south"],
    ["Pacific/Bougainville", "south"],
    ["Pacific/Pitcairn", "south"],
    ["America/Santarem", "south"],
    ["America/Eirunepe", "south"],
    ["America/Cordoba", "south"],
    ["America/Mendoza", "south"],
    ["America/Jujuy", "south"],
    ["America/Catamarca", "south"],
    ["America/Rosario", "south"],
    // Straddlers go by the latitude of the zone's named city.
    ["America/Guayaquil", "south"],
    ["Asia/Jakarta", "south"],
    ["Africa/Nairobi", "south"],
    ["Africa/Kampala", "north"],
    ["Asia/Singapore", "north"],
    ["Europe/Paris", "north"],
    ["Asia/Beirut", "north"],
    ["America/New_York", "north"],
    ["Asia/Tokyo", "north"],
    ["UTC", "north"],
    ["Not/AZone", "north"],
    ["", "north"],
    [null, "north"],
    [undefined, "north"],
  ];
  for (const [zone, expected] of table) {
    it(`${String(zone)} -> ${expected}`, () => {
      expect(hemisphereFromZone(zone)).toBe(expected);
    });
  }

  it("does not match a prefix inside a name", () => {
    expect(hemisphereFromZone("Europe/Australia/X")).toBe("north");
    expect(hemisphereFromZone("Australia")).toBe("north");
  });
});

describe("resolveHemisphere", () => {
  it("the setting wins over the zone, both ways", () => {
    expect(resolveHemisphere("north", "Australia/Sydney")).toBe("north");
    expect(resolveHemisphere("south", "Europe/Paris")).toBe("south");
  });
  it("null or undefined falls back to the zone", () => {
    expect(resolveHemisphere(null, "Pacific/Auckland")).toBe("south");
    expect(resolveHemisphere(undefined, "Europe/Paris")).toBe("north");
    expect(resolveHemisphere(null, null)).toBe("north");
  });
  it("ignores a junk value", () => {
    expect(resolveHemisphere("nord" as never, "Pacific/Auckland")).toBe("south");
  });
});
