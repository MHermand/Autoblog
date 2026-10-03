import { cloneElement, useId, type ReactElement, type ReactNode } from "react";
import { cn } from "cn";
import { Label } from "@/components/ui/label";

interface FieldProps {
  label: ReactNode;
  /** The single form control to label. It receives `id`, `aria-describedby` and `aria-invalid`. */
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean }>;
  hint?: ReactNode;
  error?: ReactNode;
  /** Shown on the label row, right-aligned (e.g. a character counter). */
  aside?: ReactNode;
  className?: string;
}

/** Label + control + hint + error, wired together for assistive technology. */
export function Field({ label, children, hint, error, aside, className }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("grid content-start gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        {aside}
      </div>
      {cloneElement(children, { id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
