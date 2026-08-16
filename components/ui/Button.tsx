import { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "accent";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  variant?: ButtonVariant;
};

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

  return (
    <button className={`${baseStyle} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
