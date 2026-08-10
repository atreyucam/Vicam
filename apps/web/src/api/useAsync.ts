import { useQuery } from "@tanstack/react-query";
import { useCallback, useId } from "react";

export type AsyncState<T> = { data?: T; error?: Error; loading: boolean };
export function useAsync<T>(loader: () => Promise<T>, dependencies: readonly unknown[] = []) {
  const instanceId = useId();
  const query = useQuery({
    queryKey: ["vicam-loader", instanceId, ...dependencies],
    queryFn: loader,
    networkMode: "always",
  });
  const reload = useCallback(() => {
    void query.refetch();
  }, [query.refetch]);
  return {
    ...(query.data === undefined ? {} : { data: query.data }),
    ...(query.error instanceof Error ? { error: query.error } : {}),
    loading: query.isLoading || query.isFetching,
    reload,
  } satisfies AsyncState<T> & { reload: () => void };
}
