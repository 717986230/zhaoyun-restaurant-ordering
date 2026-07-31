import { Capacitor, registerPlugin } from "@capacitor/core";
import type { DiscoveredPrinter, PrinterProfile } from "@zhaoyun/domain";

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
