import * as React from "react";
import { Controller, type Control, type FieldErrors } from "react-hook-form";
import { Checkbox, Field, Input, SearchableSelect, Textarea, cn } from "@jst/ui";
import { makeLookupLoader, useAccess } from "@jst/data-access";
import type { FieldDef } from "./types";

const spanClass = { 1: "", 2: "sm:col-span-2", 3: "sm:col-span-2 lg:col-span-3" };

export function FieldInput({
  def,
  control,
  errors,
  mode,
}: {
  def: FieldDef;
  control: Control<Record<string, unknown>>;
  errors: FieldErrors<Record<string, unknown>>;
  mode: "create" | "edit";
}) {
  const { companyId } = useAccess();
  const id = `f_${def.name}`;
  const err = errors[def.name]?.message as string | undefined;
  const locked = mode === "edit" && def.lockOnEdit;
  const lookup = React.useMemo(
    () => (def.lookup ? makeLookupLoader(def.lookup, companyId) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [def.lookup?.table, companyId],
  );

  if (def.kind === "checkbox") {
    return (
      <div className={cn("flex items-center pb-3 pt-5", spanClass[def.span ?? 1])}>
        <Controller
          control={control}
          name={def.name}
          render={({ field }) => (
            <Checkbox id={id} checked={Boolean(field.value)} onChange={field.onChange} label={def.label} description={def.hint} disabled={locked} />
          )}
        />
      </div>
    );
  }

  const hint = def.hint ?? (def.autoCode && mode === "create" ? "Leave blank to auto-number" : undefined);

  return (
    <Field label={def.label} required={def.required && !(def.autoCode && mode === "create")} error={err} hint={hint} htmlFor={id} className={spanClass[def.span ?? 1]}>
      <Controller
        control={control}
        name={def.name}
        render={({ field }) => {
          const common = { id, disabled: locked, invalid: !!err };
          switch (def.kind) {
            case "textarea":
              return <Textarea {...common} value={String(field.value ?? "")} onChange={field.onChange} onBlur={field.onBlur} placeholder={def.placeholder} rows={2} />;
            case "select":
              return (
                <SearchableSelect
                  {...common}
                  value={(field.value as string) || null}
                  onChange={(v) => field.onChange(v ?? "")}
                  options={def.options}
                  clearable={!def.required}
                  placeholder={def.placeholder}
                />
              );
            case "lookup":
              return (
                <SearchableSelect
                  {...common}
                  value={(field.value as string) || null}
                  onChange={(v) => field.onChange(v ?? "")}
                  loadOptions={lookup!.load}
                  resolveOption={lookup!.resolve}
                  clearable={!def.required}
                  placeholder={def.placeholder ?? "Search…"}
                />
              );
            case "number":
            case "money":
              return (
                <Input
                  {...common}
                  inputMode="decimal"
                  className="text-right tabular-nums"
                  value={String(field.value ?? "")}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder={def.placeholder}
                />
              );
            case "date":
              return <Input {...common} type="date" value={String(field.value ?? "")} onChange={field.onChange} onBlur={field.onBlur} />;
            default:
              return (
                <Input
                  {...common}
                  type={def.kind === "email" ? "email" : def.kind === "phone" ? "tel" : "text"}
                  value={String(field.value ?? "")}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  placeholder={def.placeholder}
                  autoComplete="off"
                />
              );
          }
        }}
      />
    </Field>
  );
}
