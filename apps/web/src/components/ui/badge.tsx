import { HTMLAttributes, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";

const badgeStyles = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      tone: {
        default: "border-transparent bg-secondary text-secondary-foreground",
        outline: "border-border text-foreground",
        muted: "border-transparent bg-muted text-muted-foreground",
        positive: "border-transparent bg-emerald-600/10 text-emerald-600 dark:text-emerald-300",
        warning: "border-transparent bg-amber-600/10 text-amber-600 dark:text-amber-300",
        danger: "border-transparent bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
);

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeStyles> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(({ className, tone, ...props }, ref) => (
  <span ref={ref} className={cn(badgeStyles({ tone }), className)} {...props} />
));
Badge.displayName = "Badge";
