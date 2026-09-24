import { describe, expect, it } from "vitest";
import { installPlatform } from "./install";

describe("which install steps the console shows", () => {
  it("tells each browser its own way", () => {
    expect(installPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0", 0)).toBe("chromium");
    expect(installPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", 0)).toBe("safari");
    // An iPad asks for the desktop site and says it is a Mac; its touch screen gives it away.
    expect(installPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15", 5)).toBe("ios");
    expect(installPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/128.0 Mobile/15E148 Safari/604.1", 5)).toBe("ios");
    expect(installPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Mobile Safari/537.36", 5)).toBe("android");
    expect(installPlatform("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0", 0)).toBe("unsupported");
  });
});
