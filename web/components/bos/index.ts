/**
 * Justx BOS Design System — public surface.
 *
 * Wrap any surface in <BosRoot> to opt in; everything is scoped under `.bos`
 * so existing JBT screens are unaffected. See docs/BOS_DESIGN_SYSTEM.md.
 */
export { BosRoot, type BosRootProps } from "./BosRoot";
export { BosPortal, useBosTheme } from "./theme-context";
export { BosIcon, type BosIconName } from "./icons";
export { cx } from "./cx";
export * from "./tokens";

export { Button, IconButton, type BosButtonVariant } from "./primitives/Button";
export { Badge, StatusLight, type BosBadgeTone, type BosLightState } from "./primitives/Badge";
export { Segmented, ThemeToggle, type BosSegmentOption } from "./primitives/Segmented";
export { Field, FormGrid, Input, Select, Textarea, SearchInput, Switch, Checkbox } from "./primitives/Form";
export { Alert, EmptyState, Skeleton, ProgressBar } from "./primitives/Feedback";
export { Card, IconChip, KpiCard, WidgetCard, WidgetRow, type BosKpi, type BosDeltaTone, type BosValueTone } from "./primitives/Card";
export { Avatar, AvatarStack, type BosAvatarSize } from "./primitives/Avatar";
export { FilterChip, Kbd, TimePill, Breadcrumbs, type BosCrumb } from "./primitives/Misc";

export { Dialog, type BosDialogProps } from "./overlays/Dialog";
export { ToastProvider, useToast, type BosToastInput } from "./overlays/Toast";
export { CommandPalette, useCommandHotkey, type BosCommand } from "./overlays/CommandPalette";

export {
  BarChart,
  GroupedBarChart,
  DonutChart,
  Sparkline,
  ChartLegend,
  ChartCard,
  type BosChartTone,
  type BosBarDatum,
  type BosGroupedDatum,
  type BosDonutSegment,
} from "./charts/Charts";

export { Topbar, Brand, Hero, Section, Grid, BlockLabel, Footnote } from "./patterns/Layout";
export { AppShell, NavBrand, ModuleHeader, ModuleToolbar, AiPill, type BosNavItem } from "./patterns/AppShell";
export { DataTable, Pagination, PersonCell, type BosColumn } from "./patterns/DataTable";
export { Kanban, type BosKanbanColumn, type BosKanbanCard } from "./patterns/Kanban";
export { MonthCalendar, type BosCalendarEvent } from "./patterns/MonthCalendar";
export { OrgChart, type BosOrgNode } from "./patterns/OrgChart";
export {
  ActionTicker,
  Celebrations,
  ApprovalRow,
  BalanceRow,
  type BosTickerItem,
  type BosCelebration,
  type BosApprovalDecision,
} from "./patterns/Activity";
export { ProfileHeader, DetailsGrid, type BosDetail } from "./patterns/Profile";
