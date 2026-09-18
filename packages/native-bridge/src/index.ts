import { Capacitor, registerPlugin } from "@capacitor/core";
import type { DiscoveredPrinter, PrinterProfile } from "@zhaoyun/domain";

/**
 * Marks the document with the platform it is running on, as `plt-android`,
 * `plt-ios` or `plt-web`.
 *
 * The stylesheet has always had rules for `html.plt-android` — the one that
 * matters replaces a full-screen `blur(3px)` over the whole card stack with
 * plain opacity while a dish is open. Nothing ever set the class, though: it is
 * Ionic's convention and this app is bare Capacitor. So every tablet has been
 * running a real-time Gaussian blur over the menu on every dish tap, which is
 * exactly the kind of thing that looks fine in a desktop browser and stutters
 * on the hardware a restaurant actually buys.
 */
export function markPlatform(): string {
  const platform = Capacitor.getPlatform();
  document.documentElement.classList.add(`plt-${platform}`);
  return platform;
}

interface KioskPlugin {
  status(): Promise<{ configured: boolean; locked: boolean }>;
  configure(options: { pin: string }): Promise<void>;
  lock(): Promise<void>;
  unlock(options: { pin: string }): Promise<void>;
}

export const kiosk = {
  isNative: () => Capacitor.isNativePlatform(),
  plugin: registerPlugin<KioskPlugin>("Kiosk")
};

interface PrinterPlugin {
  discover(): Promise<{ devices: DiscoveredPrinter[] }>;
  testPrint(printer: PrinterProfile): Promise<void>;
}

export const printer = {
  isNative: () => Capacitor.isNativePlatform(),
  plugin: registerPlugin<PrinterPlugin>("Printer")
};
