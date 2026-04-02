import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icons } from "./icons";

interface SilencedNotificationsMessageProps {
  children: ReactNode;
  className?: string;
}

export function SilencedNotificationsMessage({
  children,
  className,
}: SilencedNotificationsMessageProps) {
  return (
    <div className={cn("w-full flex justify-center py-2 px-3", className)}>
      <div className="text-[13px] font-normal text-[#7978DF] text-center whitespace-nowrap max-w-full flex items-center justify-center gap-1.5">
        <Icons.silencedMoon className="h-4 w-4 shrink-0 text-current" />
        {children}
      </div>
    </div>
  );
}
