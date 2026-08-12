import type { CustomerDispatch, CustomerState } from "../../app/model";
import { restaurantApi } from "../../app/api";
import { tableNo } from "../../app/table";
import { services } from "@zhaoyun/domain";

const iconPaths: Record<string, string> = {
  water: "M12 3s6 6.4 6 10.4A6 6 0 1 1 6 13.4C6 9.4 12 3 12 3Z",
  utensils: "M7 3v8M4 3v8M10 3v8M4 7h6M7 11v10M17 3v18M14 3h6",
  napkin: "M5 4h14v16H5zM8 7h8M8 11h8M8 15h5",
  takeaway: "M5 8h14l-1 12H6L5 8ZM8 8a4 4 0 0 1 8 0",
  clear: "M4 19h16M7 19V8h10v11M9 8V5h6v3",
  pay: "M3 6h18v12H3zM3 10h18M7 15h4"
};

export function ServiceScreen({ state, dispatch }: { state: CustomerState; dispatch: CustomerDispatch }) {
  async function requestService(service: (typeof services)[number]) {
    const [serviceType, label, de] = service;
    const localId = crypto.randomUUID();
    const table = tableNo();
    let id: string = localId;
    let pendingSync = false;
    try {
      const result = await restaurantApi.createServiceRequest({ table, type: serviceType });
      id = result.request.id;
    } catch {
      pendingSync = true;
    }
    dispatch({ type: "service-created", request: { id, table, serviceType, label, status: "open", createdAt: new Date().toISOString(), ...(pendingSync ? { pendingSync: true } : {}) }, message: `${label}请求已发送，服务员马上过来` });
    dispatch({ type: "toast", message: pendingSync ? "服务请求等待同步" : "服务请求已发送" });
  }

  return <section id="service" className="screen panel active"><header className="panel-head"><button className="icon-btn back" onClick={() => dispatch({ type: "navigate", screen: "home" })}>‹</button><div><h2>呼叫服务员</h2><small>SERVICE RUFEN</small></div></header><div className="content"><div id="serviceGrid" className="service-grid">{services.map((service) => <button className="service" key={service[0]} onClick={() => requestService(service)}><svg aria-hidden="true" viewBox="0 0 24 24"><path d={iconPaths[service[0]]} /></svg><b>{service[1]}</b><small>{service[2]}</small></button>)}</div><p id="serviceStatus" className="status">{state.serviceMessage}</p></div></section>;
}
