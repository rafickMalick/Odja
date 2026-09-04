import type { ReactNode } from "react";

import { MakerShell } from "./MakerShell";

export default function EspaceCreateurLayout({ children }: { children: ReactNode }) {
  return <MakerShell>{children}</MakerShell>;
}
