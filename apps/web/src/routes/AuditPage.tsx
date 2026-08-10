import { StatePanel } from "@vicam/ui";
import { api, unwrap } from "../api/api";
import { useAsync } from "../api/useAsync";
import { formatDateTime, LoadBoundary } from "./shared";
export function AuditPage() {
  const state = useAsync(
    async () => unwrap(await api.GET("/audit", { params: { query: { page: 1, pageSize: 20 } } })),
    [],
  );
  const items = state.data?.items ?? [];
  return (
    <LoadBoundary error={state.error} loading={state.loading} reload={state.reload}>
      {items.length ? (
        <div className="desktop-table-wrap always">
          <table className="data-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Acción</th>
                <th>Entidad</th>
                <th>Campos</th>
                <th>Request ID</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{formatDateTime(item.createdAt, "America/Guayaquil")}</td>
                  <td>{item.action}</td>
                  <td>{item.entityType}</td>
                  <td>{item.changedFields.join(", ") || "Sin detalle"}</td>
                  <td>
                    <code>{item.requestId}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <StatePanel kind="empty" title="Sin actividad registrada">
          <p>Los eventos auditables aparecerán aquí.</p>
        </StatePanel>
      )}
    </LoadBoundary>
  );
}
