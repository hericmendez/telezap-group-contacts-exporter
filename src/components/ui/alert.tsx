import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Info, TriangleAlert, CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";

const alertVariants = cva("relative w-full rounded-lg border p-4 text-sm [&>svg]:size-4", {
  variants: {
    variant: {
      default: "bg-background text-foreground",
      info: "border-blue-500/30 bg-blue-500/10 text-foreground dark:text-blue-200 [&>svg]:text-blue-600 dark:[&>svg]:text-blue-400",
      destructive: "border-destructive/50 text-destructive dark:border-destructive [&>svg]:text-destructive",
      success: "border-primary/40 bg-primary/10 text-foreground [&>svg]:text-primary",
    },
  },
  defaultVariants: { variant: "default" },
});

const icons = { default: Info, info: Info, destructive: TriangleAlert, success: CircleCheck } as const;

export interface AlertProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof alertVariants> {}

function Alert({ className, variant = "default", children, ...props }: AlertProps) {
  const Icon = icons[variant ?? "default"];
  return (
    <div role="alert" className={cn(alertVariants({ variant }), className)} {...props}>
      <Icon aria-hidden="true" className="absolute left-4 top-4" />
      <div className="pl-7">{children}</div>
    </div>
  );
}

function AlertTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("mb-1 font-medium leading-none tracking-tight", className)} {...props} />;
}

function AlertDescription({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export { Alert, AlertTitle, AlertDescription };
