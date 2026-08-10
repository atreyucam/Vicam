import "@testing-library/jest-dom/vitest";
import "@vicam/ui/styles.css";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
