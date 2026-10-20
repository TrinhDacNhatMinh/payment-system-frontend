import type { ThemeConfig } from 'antd';

export const designTokens = {
  primary: '#1677FF',
  primaryHover: '#0958D9',
  canvas: '#F5F7FA',
  surface: '#FFFFFF',
  text: '#1F2937',
  textSecondary: '#667085',
  border: '#E4E7EC',
  borderControl: '#D0D5DD',
  focus: '#91CAFF',
  success: '#237804',
  warning: '#874D00',
  error: '#B42318',
  fontFamily: "Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
} as const;

export function createTheme(reducedMotion: boolean): ThemeConfig {
  return {
    token: {
      colorPrimary: designTokens.primary,
      colorPrimaryHover: designTokens.primaryHover,
      colorBgLayout: designTokens.canvas,
      colorBgContainer: designTokens.surface,
      colorText: designTokens.text,
      colorTextSecondary: designTokens.textSecondary,
      colorBorder: designTokens.borderControl,
      colorBorderSecondary: designTokens.border,
      colorSuccess: designTokens.success,
      colorWarning: designTokens.warning,
      colorError: designTokens.error,
      fontFamily: designTokens.fontFamily,
      fontSize: 14,
      lineHeight: 1.5,
      borderRadius: 6,
      controlHeight: 42,
      motion: !reducedMotion,
    },
    components: {
      Card: { borderRadiusLG: 10 },
      Tag: { borderRadiusSM: 4 },
    },
  };
}

export function applyThemeVariables(element: HTMLElement) {
  for (const [name, value] of Object.entries(designTokens)) {
    element.style.setProperty(`--app-${name}`, value);
  }
}
