/**
 * Inventory Flow design tokens.
 *
 * Product identity tokens are intentionally separate from dealership tenant
 * labels and licensed OEM skins. The product mark must never inherit an OEM
 * color or logo.
 */
export const flowTokens = {
  color: {
    product: {
      ink: "#071722",
      midnight: "#0A1D2E",
      slate: "#142A45",
      flow: "#4C5EFF",
      flowStrong: "#3546DB",
      arc: "#2ED3E6",
      ice: "#8CEEFF",
      paper: "#F6FAFD",
      white: "#FFFFFF",
    },
    neutral: {
      0: "#FFFFFF",
      25: "#FBFDFE",
      50: "#F6FAFD",
      100: "#EDF3F7",
      200: "#D8E3EA",
      300: "#BBCAD4",
      400: "#8EA2B0",
      500: "#687D8C",
      600: "#526778",
      700: "#354A5A",
      800: "#1D3343",
      900: "#0A1D2E",
      950: "#071722",
    },
    semantic: {
      success: "#087A58",
      successSurface: "#E8F8F2",
      warning: "#986000",
      warningSurface: "#FFF4D6",
      danger: "#B92F3D",
      dangerSurface: "#FFECEF",
      info: "#1263BF",
      infoSurface: "#EAF4FF",
      hold: "#6941C6",
      holdSurface: "#F2EDFF",
    },
  },
  font: {
    display: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    text: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    mono: '"Cascadia Code", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
    size: { xs: 12, sm: 13, md: 14, body: 15, lg: 16, xl: 19, h4: 23, h3: 30, h2: 36, h1: 48 },
    lineHeight: { tight: 1.1, title: 1.18, compact: 1.4, body: 1.55, relaxed: 1.65 },
    weight: { regular: 400, medium: 500, semibold: 600, bold: 700, heavy: 700 },
    tracking: { tight: "-0.018em", title: "-0.012em", normal: "0", label: "0.008em", caps: "0.045em" },
  },
  space: { 0: 0, 0.5: 2, 1: 4, 1.5: 6, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 },
  radius: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24, full: 999 },
  border: { hairline: 1, strong: 2 },
  elevation: {
    0: "none",
    1: "0 1px 2px rgb(7 23 34 / 6%), 0 4px 12px rgb(7 23 34 / 5%)",
    2: "0 8px 24px rgb(7 23 34 / 9%), 0 2px 6px rgb(7 23 34 / 5%)",
    3: "0 18px 52px rgb(7 23 34 / 14%), 0 4px 12px rgb(7 23 34 / 7%)",
    4: "0 28px 90px rgb(7 23 34 / 22%), 0 8px 24px rgb(7 23 34 / 10%)",
    action: "0 9px 22px rgb(76 94 255 / 28%), inset 0 1px rgb(255 255 255 / 28%)",
  },
  motion: {
    duration: { instant: 70, fast: 140, standard: 220, deliberate: 360, scene: 600 },
    easing: {
      standard: "cubic-bezier(0.2, 0.78, 0.2, 1)",
      enter: "cubic-bezier(0.16, 1, 0.3, 1)",
      exit: "cubic-bezier(0.4, 0, 1, 1)",
      tactile: "cubic-bezier(0.22, 0.9, 0.3, 1)",
    },
  },
  control: {
    height: { sm: 36, md: 44, lg: 48 },
    icon: { sm: 16, md: 18, lg: 22 },
  },
  layout: { contentMax: 1680, readable: 720, rail: 72, touchTarget: 44 },
} as const;

export type OemSkinName = "ford" | "lincoln" | "neutral";

/** Visual atmosphere only. Authorized OEM/dealer logo assets stay external. */
export const oemSkins = {
  neutral: {
    accent: "#4C5EFF",
    accentStrong: "#3546DB",
    surface: "#EEF0FF",
    metal: "#D8E3EA",
    sceneDeep: "#071722",
    sceneMid: "#4C5EFF",
    sceneGlow: "#2ED3E6",
  },
  ford: {
    accent: "#0A5EB8",
    accentStrong: "#003478",
    surface: "#EAF3FF",
    metal: "#D9ECFF",
    sceneDeep: "#001A3D",
    sceneMid: "#075FB5",
    sceneGlow: "#68B8FF",
  },
  lincoln: {
    accent: "#5E686D",
    accentStrong: "#252B2E",
    surface: "#F1F3F3",
    metal: "#D8DDDF",
    sceneDeep: "#161A1C",
    sceneMid: "#5E696E",
    sceneGlow: "#D8DDDF",
  },
} as const;

export interface BrandContext {
  /** Replaceable dealership/group label, for example “Maxey”. */
  tenantLabel: string;
  /** Optional tenant-owned logo path; never baked into the product mark. */
  tenantLogoUrl?: string;
  oemSkin: OemSkinName;
  /** Optional authorized OEM mark path supplied by the tenant. */
  oemLogoUrl?: string;
}

export function getOemSkin(name: OemSkinName) {
  return oemSkins[name];
}
