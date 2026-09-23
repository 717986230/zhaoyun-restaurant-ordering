import { useEffect, useRef } from "react";
import { kiosk } from "@zhaoyun/native-bridge";

/** Seven taps on the menu's title within four seconds opens the admin console. */
export const ADMIN_TAPS = 7;
const TAP_WINDOW_MS = 4000;

/**
 * The way from the menu to the admin console.
 *
 * On the web — a guest's phone, or the owner's — seven quick taps on the title
 * go to `admin.html`, and that page asks for the password. The taps are not
 * the lock; the password is. They only keep a guest from wandering onto a
 * password screen by accident, so there is no point making them harder to
 * find than this, and no second password to type here.
 *
 * Inside the Android kiosk shell the same taps still ask for the kiosk PIN
 * first, because there they also unpin the tablet from the menu.
 */
export function useKiosk() {
  const taps = useRef(0);
  const resetTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!kiosk.isNative()) return;
    void (async () => {
      try {
        const { configured } = await kiosk.plugin.status();
        if (configured) {
          await kiosk.plugin.lock();
          return;
        }
        const pin = window.prompt("首次配置：请设置 6-12 位管理员数字 PIN");
        if (!pin) return;
        const confirmation = window.prompt("请再次输入管理员 PIN");
        if (pin !== confirmation) {
          window.alert("两次 PIN 不一致");
          return;
        }
        await kiosk.plugin.configure({ pin });
      } catch (error) {
        window.alert(error instanceof Error ? error.message : "终端模式配置失败");
      }
    })();
  }, []);

  return async function handleAdminTap() {
    taps.current += 1;
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => { taps.current = 0; }, TAP_WINDOW_MS);
    if (taps.current < ADMIN_TAPS) return;
    taps.current = 0;
    if (!kiosk.isNative()) {
      // Relative, so it lands on the right page under a GitHub Pages sub-path
      // as well as at the root of the Worker.
      window.location.href = "admin.html";
      return;
    }
    const pin = window.prompt("管理员解锁 PIN");
    if (!pin) return;
    try {
      await kiosk.plugin.unlock({ pin });
      window.location.href = "admin.html";
    } catch {
      window.alert("PIN 错误");
    }
  };
}
