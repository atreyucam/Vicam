import type { Pool } from "pg";

export async function closeIntegrationPool(pool: Pool): Promise<void> {
  const openClients = pool.totalCount;
  let removedClients = 0;

  const clientsClosed =
    openClients === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const handleRemove = () => {
            removedClients += 1;
            if (removedClients !== openClients) return;
            pool.off("remove", handleRemove);
            resolve();
          };
          pool.on("remove", handleRemove);
        });

  await pool.end();
  await clientsClosed;
}
