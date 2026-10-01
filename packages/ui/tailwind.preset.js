/**
 * JS Traders ERP design tokens (spec §5.5.1A / §5.5.2).
 * Soft modern business theme: neutral-first, white surfaces, compact controls.
 * Every app consumes this preset so a token change propagates everywhere.
 */
/** @type {import('tailwindcss').Config} */
export default {
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
      },
      fontSize: {
        // compact ERP scale: [size, lineHeight]
        "2xs": ["11px", "14px"],
        xs: ["12px", "16px"],
        sm: ["13px", "18px"],
        base: ["14px", "20px"],
        lg: ["16px", "22px"],
        xl: ["18px", "24px"],
        "2xl": ["22px", "28px"],
      },
      colors: {
        page: "#F5F6F8",
        surface: "#FFFFFF",
        subtle: "#F8F9FB",
        field: "#F4F5F7",
        line: { DEFAULT: "#E6E8EC", strong: "#D5D8DE" },
        ink: { DEFAULT: "#111827", 2: "#374151", muted: "#6B7280", faint: "#9CA3AF" },
        primary: { DEFAULT: "#111827", hover: "#1F2937", fg: "#FFFFFF" },
        success: { DEFAULT: "#15803D", soft: "#ECFDF3", line: "#BBF7D0" },
        warning: { DEFAULT: "#B45309", soft: "#FFFBEB", line: "#FDE68A" },
        danger: { DEFAULT: "#B91C1C", soft: "#FEF2F2", line: "#FECACA" },
        info: { DEFAULT: "#1D4ED8", soft: "#EFF6FF", line: "#BFDBFE" },
      },
      height: { control: "34px", "control-sm": "28px", row: "36px" },
      minHeight: { control: "34px" },
      borderRadius: { control: "8px", card: "12px", dialog: "14px" },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,0.04), 0 1px 3px rgba(16,24,40,0.04)",
        pop: "0 8px 24px rgba(16,24,40,0.10), 0 2px 6px rgba(16,24,40,0.06)",
        dialog: "0 20px 48px rgba(16,24,40,0.18)",
        focus: "0 0 0 3px rgba(17,24,39,0.10)",
      },
      maxWidth: { "dialog-sm": "480px", "dialog-md": "720px", "dialog-lg": "960px", "dialog-xl": "1180px" },
    },
  },
  plugins: [],
};
