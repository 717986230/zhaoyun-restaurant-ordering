import { useEffect, useRef } from "react";
import { kiosk } from "@zhaoyun/native-bridge";

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
    if (!kiosk.isNative()) return;
    taps.current += 1;
    window.clearTimeout(resetTimer.current);
    resetTimer.current = window.setTimeout(() => { taps.current = 0; }, 4000);
    if (taps.current < 7) return;
    taps.current = 0;
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
