import { useRef } from "react";

export function createIdempotencyKey() {
  return crypto.randomUUID();
}

export function idempotencyParams(key: string) {
  return { header: { "idempotency-key": key } } as const;
}

/** One key per mounted user intent; transport and manual retries reuse it. */
export function useIdempotencyKey() {
  const key = useRef<string>(undefined);
  key.current ??= createIdempotencyKey();
  return key.current;
}

/** Keeps a key across retries and rotates it only after the intent succeeds. */
export function useIdempotencyKeyController() {
  const key = useRef<string>(undefined);
  key.current ??= createIdempotencyKey();
  return {
    current: () => key.current!,
    rotate: () => {
      key.current = createIdempotencyKey();
    },
  };
}
