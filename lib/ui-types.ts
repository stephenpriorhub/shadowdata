/** Client-facing shapes shared between page.tsx and the API (re-exported for import ergonomics). */
export type {
  ResolvedEntity,
  SignalResult,
  Metric,
  Timeseries,
  Evidence,
  SignalCategory,
  SignalStatus,
  ConnectorTier,
} from "./connectors/types";
export type { Synthesis, ThesisCard } from "./synthesis";

export interface LockedInfo {
  id: string;
  label: string;
  category: string;
  tier: "free" | "premium" | "roadmap";
  description: string;
}
