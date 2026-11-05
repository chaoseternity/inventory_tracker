import React from "react";
import { cn } from "@/lib/utils";
import { Package } from "lucide-react";

interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  showText?: boolean;
  showSubtitle?: boolean;
  iconOnly?: boolean;
  textClassName?: string;
}

export function Logo({
  size = "md",
  showText = true,
  showSubtitle = false,
  iconOnly = false,
  className,
  textClassName,
  ...props
}: LogoProps) {
  const iconSizes = {
    xs: "h-5 w-5",
    sm: "h-7 w-7",
    md: "h-8 w-8",
    lg: "h-10 w-10",
    xl: "h-12 w-12",
  };

  const textSizes = {
    xs: "text-sm",
    sm: "text-base",
    md: "text-lg",
    lg: "text-xl",
    xl: "text-2xl",
  };

  return (
    <div className={cn("flex items-center gap-2.5 min-w-0 select-none", className)} {...props}>
      {/* Inventory Tracker Emblem Badge: Solid Black Background + Clean Package Icon */}
      <div
        className={cn(
          "relative flex items-center justify-center shrink-0 rounded-xl overflow-hidden shadow-xs ring-1 ring-white/10 bg-black text-white",
          iconSizes[size]
        )}
      >
        <Package className="w-3/5 h-3/5 text-white" />
      </div>

      {/* Typography */}
      {showText && !iconOnly && (
        <div className="flex flex-col min-w-0 justify-center leading-none">
          <span
            className={cn(
              "font-extrabold tracking-tight truncate flex items-center gap-0.5 text-foreground leading-tight",
              textSizes[size],
              textClassName
            )}
          >
            <span>Inventory Tracker</span>
          </span>
          {showSubtitle && (
            <span className="text-[10px] font-bold tracking-wider uppercase text-muted-foreground truncate">
              Equipment Portal
            </span>
          )}
        </div>
      )}
    </div>
  );
}
