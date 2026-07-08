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
    primary: "bg-black text-white hover:bg-gray-800",
    secondary: "border border-gray-300 bg-white text-gray-900 hover:bg-gray-50",
    accent: "bg-[#E9CFC6] text-gray-900 hover:bg-[#DDBEB4]",
  };

  return (
    <button className={`${baseStyle} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}