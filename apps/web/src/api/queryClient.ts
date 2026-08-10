import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "always",
      retry: (failureCount, error) =>
        navigator.onLine &&
        failureCount < 1 &&
        !(error instanceof Error && error.name === "ApiError"),
      staleTime: 30_000,
    },
  },
});

export const queryKeys = {
  account: (accountId: string) => ["accounts", "detail", accountId] as const,
  accounts: (search: string, status: string, page: number) =>
    ["accounts", "list", { page, search, status }] as const,
  activeFruits: ["catalogs", "fruits", "active"] as const,
};
