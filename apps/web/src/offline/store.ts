import { create } from "zustand";

export interface OfflineClientState {
  error: string | undefined;
  setError: (error?: string) => void;
  setStatus: (status: OfflineClientStatus) => void;
  status: OfflineClientStatus;
}

export interface OfflineClientStatus {
  conflicts: number;
  failed: number;
  grantExpiresAt?: string;
  lastSyncAt?: string;
  pending: number;
  syncing: boolean;
}

export const emptyOfflineStatus: OfflineClientStatus = {
  conflicts: 0,
  failed: 0,
  pending: 0,
  syncing: false,
};

export const useOfflineStore = create<OfflineClientState>((set) => ({
  error: undefined,
  status: emptyOfflineStatus,
  setError: (error) => set({ error }),
  setStatus: (status) => set({ status }),
}));
