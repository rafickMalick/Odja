import type { ReactNode } from "react";

import { CourierShell } from "./CourierShell";

export default function CourierLayout({ children }: { children: ReactNode }) {
  return <CourierShell>{children}</CourierShell>;
}
