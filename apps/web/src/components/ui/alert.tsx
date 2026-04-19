import { HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const alertStyles = cva("relative w-full rounded-lg border p-4 text-sm", {
  variants: {
    tone: {
      default: "border-border bg-muted/40 text-foreground",
      info: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-200",
      warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900/40 dark:bg-amber-950/40 dark:text-amber-200",
      danger: "border-destructive/30 bg-destructive/10 text-destructive",
    },
  },
  defaultVariants: {
    tone: "default",
  },
});

export interface AlertProps extends HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertStyles> {}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(({ className, tone, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertStyles({ tone }), className)} {...props} />
));
Alert.displayName = "Alert";
