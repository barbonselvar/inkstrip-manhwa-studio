import { cn } from "@/lib/utils";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

const buttonVariants = cva(
  "studio-button press focus-ring inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      variant: {
        primary: "primary-button bg-accent text-accent-fg hover:brightness-105",
        secondary: "border border-border bg-bg-subtle text-fg hover:bg-bg-elevated",
        ghost: "text-fg hover:bg-bg-subtle",
        danger: "text-danger hover:bg-danger/10",
      },
      size: {
        md: "h-11 rounded-sm px-4 text-sm",
        sm: "h-11 rounded-sm px-3 text-sm",
        icon: "size-11 rounded-sm",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export function buttonClass({
  className,
  variant,
  size,
}: {
  className?: string;
} & VariantProps<typeof buttonVariants>) {
  return cn(buttonVariants({ variant, size }), className);
}

export function Button({
  className,
  variant,
  size,
  type = "button",
  intent,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & { intent?: "ai" | "save" | "export" | "create" }) {
  return (
    <button
      type={type}
      data-variant={variant ?? "primary"}
      data-intent={intent}
      title={props.title ?? (size === "icon" ? props["aria-label"] : undefined)}
      className={buttonClass({ className, variant, size })}
      {...props}
    />
  );
}
