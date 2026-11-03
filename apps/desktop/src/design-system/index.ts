/**
 * Vater 디자인 시스템 ("대시보드 라이트"). 화면(src/screens)은 여기서만 가져온다.
 * 전역 스타일은 앱 진입점에서 한 번: import './design-system/styles.css'
 * 규칙과 결정의 근거: 저장소 루트 DESIGN.md
 */
export * from './format/money';
export { AiText, type AiTextProps } from './components/AiText';
export { AppShell, type AppShellProps } from './components/AppShell';
export { Banner, type BannerProps } from './components/Banner';
export { Button, type ButtonProps } from './components/Button';
export { Card, type CardProps } from './components/Card';
export { DataTable, type Column, type DataTableProps } from './components/DataTable';
export {
  DECISION_LABEL,
  DecisionScale,
  type Decision,
  type DecisionScaleProps,
} from './components/DecisionScale';
export {
  DISCLAIMER_ANALYSIS,
  DISCLAIMER_BASE,
  Disclaimer,
  type DisclaimerProps,
} from './components/Disclaimer';
export { Dialog, type DialogProps } from './components/Dialog';
export { FeedStatus, type FeedState, type FeedStatusProps } from './components/FeedStatus';
export { Icon, type IconName, type IconProps } from './components/Icon';
export { KpiTile, type KpiTileProps } from './components/KpiTile';
export {
  MarketState,
  type Market,
  type MarketStateProps,
  type MarketStatus,
} from './components/MarketState';
export { Menu, type MenuItem, type MenuProps } from './components/Menu';
export { ProgressBar, type ProgressBarProps } from './components/ProgressBar';
export { Section, type SectionProps } from './components/Section';
export {
  SegmentedControl,
  type SegmentedControlProps,
  type SegmentOption,
} from './components/SegmentedControl';
export { Select, type SelectOption, type SelectProps } from './components/Select';
export { SidebarNav, type NavItem, type SidebarNavProps } from './components/SidebarNav';
export {
  PriceChange,
  SignedNumber,
  type PriceChangeProps,
  type SignedFormat,
  type SignedTone,
  type SignedNumberProps,
} from './components/SignedNumber';
export { Sparkline, type SparklineProps } from './components/Sparkline';
export {
  StatusBar,
  StatusBarItem,
  type StatusBarItemProps,
  type StatusBarProps,
} from './components/StatusBar';
export { StatusDot, type DotTone } from './components/StatusDot';
export { Tab, TabList, TabPanel, Tabs, type TabListProps, type TabsProps } from './components/Tabs';
export { TextField, type TextFieldProps } from './components/TextField';
export { Toggle, type ToggleProps } from './components/Toggle';
export { VisuallyHidden } from './components/VisuallyHidden';
