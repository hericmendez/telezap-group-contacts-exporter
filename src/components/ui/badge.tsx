import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground",
        outline: "text-foreground",
        success: "border-transparent bg-primary text-primary-foreground",
        warning: "border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400",
        muted: "border-transparent bg-muted text-muted-foreground",
        destructive: "border-transparent bg-destructive text-white",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {
  dot?: boolean;
}

function Badge({ className, variant, dot = false, children, ...props }: BadgeProps) {
  return (
    <span className={cn(badgeVariants({ variant }), className)} {...props}>
      {dot && (
        <span aria-hidden="true" className="inline-block size-2 rounded-full bg-current" />
      )}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
