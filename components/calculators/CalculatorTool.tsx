"use client";

import { useEffect, type ComponentType } from "react";
import type { ToolDefinition } from "@/config/tools.config";
import { trackCalcRun } from "@/lib/analytics";
import { CommissionCalcView } from "@/components/calculators/CommissionCalcView";
import { EmiCalcView } from "@/components/calculators/EmiCalcView";
import { GstCalcView } from "@/components/calculators/GstCalcView";
import { LoanCalcView } from "@/components/calculators/LoanCalcView";
import { ProfitCalcView } from "@/components/calculators/ProfitCalcView";
import { SolarRoiCalcView } from "@/components/calculators/SolarRoiCalcView";
import { TaxCalcView } from "@/components/calculators/TaxCalcView";
import { TdsCalcView } from "@/components/calculators/TdsCalcView";

const CALCULATOR_VIEWS: Record<string, ComponentType> = {
  gstcalc: GstCalcView,
  tdscalc: TdsCalcView,
  taxcalc: TaxCalcView,
  profitcalc: ProfitCalcView,
  emicalc: EmiCalcView,
  loancalc: LoanCalcView,
  solarroi: SolarRoiCalcView,
  dealercommission: CommissionCalcView,
};

type Props = { tool: ToolDefinition };

export function CalculatorTool({ tool }: Props) {
  const View = CALCULATOR_VIEWS[tool.id];

  useEffect(() => {
    trackCalcRun(tool.id);
  }, [tool.id]);

  if (!View) {
    return (
      <div className="empty-state">
        <div className="es-icon">🚧</div>
        <div className="es-title">Calculator not found</div>
      </div>
    );
  }
  return <View />;
}
