import { describe, expect, it } from "vitest";
import { sectorFromSic } from "../sector";

describe("sectorFromSic", () => {
  it("labels the two-digit divisions", () => {
    expect(sectorFromSic(["62012"])).toBe("Software");
    expect(sectorFromSic(["63110"])).toBe("Data and platforms");
    expect(sectorFromSic(["64999"])).toBe("Financial services");
    expect(sectorFromSic(["66190"])).toBe("Financial services");
    expect(sectorFromSic(["72190"])).toBe("Research and development");
    expect(sectorFromSic(["86900"])).toBe("Health");
    expect(sectorFromSic(["21200"])).toBe("Biotech");
    expect(sectorFromSic(["73110"])).toBe("Marketing");
    expect(sectorFromSic(["82990"])).toBe("Business services");
    expect(sectorFromSic(["85590"])).toBe("Education");
    expect(sectorFromSic(["35110"])).toBe("Energy");
    expect(sectorFromSic(["71129"])).toBe("Engineering");
    expect(sectorFromSic(["74100"])).toBe("Design and professional services");
  });

  it("matches the specific classes before their division", () => {
    expect(sectorFromSic(["58290"])).toBe("Software");
    expect(sectorFromSic(["58.29"])).toBe("Software");
    expect(sectorFromSic(["70229"])).toBe("Consultancy");
    expect(sectorFromSic(["47910"])).toBe("Online retail");
    // 58.11 (book publishing) and 70.10 (head offices) have no label.
    expect(sectorFromSic(["58110"])).toBeNull();
    expect(sectorFromSic(["70100"])).toBeNull();
  });

  it("takes the first code with a label and gives null when none has one", () => {
    expect(sectorFromSic(["70100", "62020"])).toBe("Software");
    expect(sectorFromSic(["96090"])).toBeNull();
    expect(sectorFromSic([])).toBeNull();
    expect(sectorFromSic(null)).toBeNull();
    expect(sectorFromSic([null, "", "x"])).toBeNull();
  });
});
