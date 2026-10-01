import { z } from "zod";
import type { FieldDef } from "./types";

/**
 * Builds a Zod schema from field definitions. Form values are kept as strings
 * (inputs) and converted on submit via `toDbValues`. Validation for fields in a
 * collapsed optional section still applies only if the user entered data.
 */
export function buildSchema(fields: FieldDef[], mode: "create" | "edit" = "create") {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const f of fields) {
    let s: z.ZodTypeAny;
    switch (f.kind) {
      case "checkbox":
        s = z.boolean();
        break;
      case "number":
      case "money": {
        const base = z
          .string()
          .trim()
          .refine((v) => v === "" || /^-?\d+(\.\d+)?$/.test(v.replace(/,/g, "")), "Enter a valid number");
        const withMin =
          f.min !== undefined
            ? base.refine((v) => v === "" || Number(v.replace(/,/g, "")) >= f.min!, `Must be ≥ ${f.min}`)
            : base;
        s = f.required ? withMin.refine((v) => v !== "", "Required") : withMin;
        break;
      }
      case "email": {
        const e = z.string().trim().refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Enter a valid email");
        s = f.required ? e.refine((v) => v !== "", "Required") : e;
        break;
      }
      default: {
        const t = z.string().trim().max(2000, "Too long");
        s = f.required && (!f.autoCode || mode === "edit") ? t.min(1, "Required") : t;
      }
    }
    if (f.kind === "select" || f.kind === "lookup") {
      s = f.required ? z.string({ required_error: "Required" }).min(1, "Required") : z.string().nullable().or(z.literal(""));
    }
    shape[f.name] = s;
  }
  return z.object(shape);
}

export function toFormValues(fields: FieldDef[], row: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = row?.[f.name] ?? (row ? null : f.defaultValue ?? null);
    if (f.kind === "checkbox") out[f.name] = Boolean(v ?? false);
    else if (f.kind === "select" || f.kind === "lookup") out[f.name] = v == null ? "" : String(v);
    else out[f.name] = v == null ? "" : String(v);
  }
  return out;
}

export function toDbValues(fields: FieldDef[], values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.kind === "checkbox") out[f.name] = Boolean(v);
    else if (f.kind === "number" || f.kind === "money") {
      const s = String(v ?? "").replace(/,/g, "").trim();
      out[f.name] = s === "" ? null : s; // keep as string → numeric in DB, no float rounding
    } else {
      const s = typeof v === "string" ? v.trim() : v;
      out[f.name] = s === "" || s === undefined ? null : s;
    }
  }
  return out;
}
