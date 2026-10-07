import { ButtonHTMLAttributes, ComponentProps, ReactNode } from "react";
import Link from "next/link";

type ButtonVariant = "primary" | "secondary" | "accent";

type ButtonProps = {
  children: ReactNode;
  variant?: ButtonVariant;
} & ((ButtonHTMLAttributes<HTMLButtonElement> & { href?: never }) |
  (Omit<ComponentProps<typeof Link>, "children"> & { href: string }));

export default function Button({
  children,
  variant = "primary",
  className = "",
  ...props
}: ButtonProps) {
  const baseStyle =
    "inline-flex items-center justify-center rounded-full px-8 py-4 text-sm font-medium transition";

  const variants: Record<ButtonVariant, string> = {
    primary:
      "bg-hanapure-text text-hanapure-white hover:bg-black",
    secondary:
      "border border-hanapure-border bg-hanapure-white text-hanapure-text hover:bg-hanapure-warm-white",
    accent:
      "bg-hanapure-beige text-hanapure-text hover:bg-hanapure-beige-deep",
  };

  if (props.href !== undefined) {
    return <Link className={`${baseStyle} ${variants[variant]} ${className}`} {...props}>{children}</Link>;
  }

  return (
    <button className={`${baseStyle} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
