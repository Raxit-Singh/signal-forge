"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PrintButton() {
  return (
    <Button size="sm" variant="secondary" type="button" onClick={() => window.print()} className="print:hidden">
      <Printer aria-hidden />Print or save as PDF
    </Button>
  );
}
