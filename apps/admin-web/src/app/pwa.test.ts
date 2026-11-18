import { describe, expect, it } from "vitest";
import { jumpLinkProps } from "./pwa";

describe("opening another app from the console", () => {
  it("opens a new tab in a browser", () => {
    // A phone or desktop browser tab: the console stays open, the app opens beside it.
    expect(jumpLinkProps("book.html", false)).toEqual({ href: "book.html", rel: "noopener noreferrer", target: "_blank" });
    expect(jumpLinkProps("pos.html", false)).toEqual({ href: "pos.html", rel: "noopener noreferrer", target: "_blank" });
  });

  it("navigates in place when installed, so iOS does not open a blank tab", () => {
    // The home-screen app (display:standalone) gets no second tab on iOS, so
    // target="_blank" would open a black screen. Dropping target lets the tap
    // navigate; iOS hands these out-of-scope pages to Safari. Regression for the
    // 跳转「在线预约」/「POS 收银」black screen.
    expect(jumpLinkProps("book.html", true)).toEqual({ href: "book.html", rel: "noopener noreferrer" });
    expect(jumpLinkProps("pos.html", true)).toEqual({ href: "pos.html", rel: "noopener noreferrer" });
    expect("target" in jumpLinkProps("pos.html", true)).toBe(false);
  });
});
