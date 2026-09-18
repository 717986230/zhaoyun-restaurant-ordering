import type { CustomerDispatch, CustomerState } from "../../app/model";
import { restaurantApi } from "../../app/api";
import { tableNo } from "../../app/table";
import { services } from "@zhaoyun/domain";
import { format, serviceName, t } from "../../app/i18n";

const iconPaths: Record<string, string> = {
  water: "M12 3s6 6.4 6 10.4A6 6 0 1 1 6 13.4C6 9.4 12 3 12 3Z",
  utensils: "M7 3v8M4 3v8M10 3v8M4 7h6M7 11v10M17 3v18M14 3h6",
  napkin: "M5 4h14v16H5zM8 7h8M8 11h8M8 15h5",
  takeaway: "M5 8h14l-1 12H6L5 8ZM8 8a4 4 0 0 1 8 0",
  clear: "M4 19h16M7 19V8h10v11M9 8V5h6v3",
  pay: "M3 6h18v12H3zM3 10h18M7 15h4"
};

export function ServiceScreen({ state, dispatch }: { state: CustomerState; dispatch: CustomerDispatch }) {
  async function requestService(serviceType: (typeof services)[number]["id"]) {
    const localId = crypto.randomUUID();
    const table = tableNo();
    let id: string = localId;
    let pendingSync = false;
    try {
      const result = await restaurantApi.createServiceRequest({ table: table, type: serviceType });
      id = result.request.id;
    } catch {
      pendingSync = true;
    }
    dispatch({ type: "service-created", request: { id, table: table, serviceType, status: "open", createdAt: new Date().toISOString(), ...(pendingSync ? { pendingSync: true } : {}) } });
    dispatch({ type: "toast", message: t(state.language, pendingSync ? "serviceQueued" : "serviceSent") });
  }

  const status = state.lastServiceType
    ? format(t(state.language, "serviceOnTheWay"), { name: serviceName(state.lastServiceType, state.language) })
    : t(state.language, "servicePrompt");

  return <section id="service" className="screen panel active"><header className="panel-head"><button className="icon-btn back" onClick={() => dispatch({ type: "navigate", screen: "home" })}>‹</button><div><h2>{t(state.language, "service")}</h2><small>SERVICE RUFEN</small></div></header><div className="content"><div id="serviceGrid" className="service-grid">{services.map((service) => <button className="service" key={service.id} onClick={() => requestService(service.id)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d={iconPaths[service.id]} /></svg><b>{serviceName(service.id, state.language)}</b><small>{service.names.de}</small></button>)}</div><p id="serviceStatus" className="status">{status}</p></div></section>;
}
