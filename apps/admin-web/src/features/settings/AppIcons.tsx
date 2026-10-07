import { useEffect, useState, type ChangeEvent } from "react";
import type { AdminApi, AdminStorage } from "@zhaoyun/api-client";
import type { ApiAppIcons, AppIconFiles, IconApp } from "@zhaoyun/contracts";
import { useI18n, type CopyKey } from "../../app/i18n";

const APPS: Array<[IconApp, CopyKey]> = [["menu", "appIconMenu"], ["pos", "appIconPos"], ["admin", "appIconAdmin"]];

/** One square of `pixels`, the picture filling it (the middle of a long one). */
function square(image: ImageBitmap, pixels: number, inset = 0, background?: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = pixels;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas");
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, pixels, pixels);
  }
  const side = Math.min(image.width, image.height);
  const drawn = pixels * (1 - inset * 2);
  context.imageSmoothingQuality = "high";
  context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, pixels * inset, pixels * inset, drawn, drawn);
  return canvas;
}

function png(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("No PNG"))), "image/png"));
}

/** The picture's corner colour: what a maskable icon's margin is filled with, so the logo sits on its own ground. */
function cornerColour(image: ImageBitmap): string {
  const [r = 255, g = 255, b = 255, a = 255] = square(image, 8).getContext("2d")?.getImageData(0, 0, 1, 1).data ?? [];
  return a < 128 ? "#ffffff" : `rgb(${r}, ${g}, ${b})`;
}

/**
 * Every size an installed app asks for, from the one picture: the iPhone's
 * 180, the manifest's 192 and 512, and a maskable 512 with the picture inside
 * the safe circle (Android cuts its icons into circles and squircles).
 */
export async function iconSizes(file: Blob): Promise<AppIconFiles> {
  const image = await createImageBitmap(file);
  try {
    return {
      icon180: await png(square(image, 180)),
      icon192: await png(square(image, 192)),
      icon512: await png(square(image, 512)),
      maskable512: await png(square(image, 512, 0.1, cornerColour(image)))
    };
  } finally {
    image.close();
  }
}

/**
 * The icons the menu, the POS and the console install with: the built ones
 * until the owner picks a picture, and back to them with one tap.
 */
export function AppIcons({ api, storage, notify, failed }: { api: AdminApi; storage: AdminStorage; notify: (message: string) => void; failed: (error: unknown) => void }) {
  const { t } = useI18n();
  const [icons, setIcons] = useState<ApiAppIcons | null>(null);
  const [busy, setBusy] = useState<IconApp | null>(null);

  useEffect(() => {
    api.appIcons().then(({ icons: loaded }) => setIcons(loaded)).catch(failed);
  }, [api]);

  async function choose(app: IconApp, event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    setBusy(app);
    try {
      let files: AppIconFiles;
      try {
        files = await iconSizes(file);
      } catch {
        notify(t("appIconBadFile"));
        return;
      }
      setIcons((await api.saveAppIcon(app, files)).icons);
      notify(t("appIconSaved"));
    } catch (error) {
      failed(error);
    } finally {
      setBusy(null);
    }
  }

  async function reset(app: IconApp) {
    setBusy(app);
    try {
      setIcons((await api.resetAppIcon(app)).icons);
      notify(t("appIconResetDone"));
    } catch (error) {
      failed(error);
    } finally {
      setBusy(null);
    }
  }

  return <div className="app-icons" id="appIcons">
    <p className="settings-hint">{t("appIconsHint")}</p>
    <ul className="app-icon-list">{APPS.map(([app, label]) => {
      const icon = icons?.[app] ?? null;
      return <li key={app} data-app={app} data-custom={icon ? "true" : "false"}>
        <img src={`${storage.baseUrl}/icons/${app}-192.png?v=${icon?.version ?? "built"}`} alt="" width="56" height="56" />
        <span className="app-icon-name"><strong>{t(label)}</strong><small>{t(icon ? "appIconCustom" : "appIconBuilt")}</small></span>
        <span className="app-icon-actions">
          <label className={`ghost-action${busy === app ? " busy" : ""}`}>
            {t("appIconChoose")}
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={busy !== null} onChange={(event) => void choose(app, event)} />
          </label>
          {icon ? <button type="button" className="ghost-action" disabled={busy !== null} onClick={() => void reset(app)}>{t("appIconReset")}</button> : null}
        </span>
      </li>;
    })}</ul>
  </div>;
}
