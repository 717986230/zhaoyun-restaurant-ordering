import { describe, expect, it } from "vitest";
import { cardFileName } from "./qrCard";

describe("QR card file names", () => {
  it("are ASCII, because a browser saves any other name as plain \"download\"", () => {
    expect(cardFileName("赵云")).toBe("menu-qr.png");
    expect(cardFileName("赵云", "12")).toBe("table-12-qr.png");
  });

  it("keep a name written in Latin letters, accents folded", () => {
    expect(cardFileName("Gasthaus Kröll")).toBe("gasthaus-kroll-menu-qr.png");
    expect(cardFileName("Chiri Kitchen", "T-3")).toBe("chiri-kitchen-table-t-3-qr.png");
  });

  it("never come out empty", () => {
    expect(cardFileName("", "")).toBe("menu-qr.png");
  });
});
