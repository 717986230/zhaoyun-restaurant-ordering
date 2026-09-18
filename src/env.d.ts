/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * The backend the built app talks to, baked in at build time.
   *
   * A tablet running the Capacitor shell has `location.origin` of `localhost`,
   * where nothing is listening, so without this an installed APK can only reach
   * a server after someone types its address into the admin console. Setting it
   * lets the APK ship pointing at the deployment. A device that has been
   * configured by hand still wins — that is what `zy_api_base` is for.
   */
  readonly VITE_API_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
