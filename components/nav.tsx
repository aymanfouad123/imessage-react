import { Icons } from "./icons";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useTheme } from "next-themes";

interface NavProps {
  onNewChat: () => void;
  isMobileView: boolean;
  isScrolled?: boolean;
}

export function Nav({ onNewChat, isMobileView, isScrolled }: NavProps) {
  const [mounted, setMounted] = useState(false);
  const { theme, systemTheme, setTheme } = useTheme();
  const effectiveTheme = theme === "system" ? systemTheme : theme;
  const themeForToggle = mounted ? effectiveTheme : "light";

  useEffect(() => {
    setMounted(true);
  }, []);

  // Keyboard shortcut for creating a new chat
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input, if command/meta key is pressed,
      // or if the TipTap editor is focused
      if (
        document.activeElement?.tagName === "INPUT" ||
        e.metaKey ||
        document.querySelector(".ProseMirror")?.contains(document.activeElement)
      ) {
        return;
      }

      if (e.key === "n") {
        e.preventDefault();
        onNewChat();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onNewChat]);

  return (
    <>
      <div
        className={cn(
          "px-4 py-2 flex items-center justify-between sticky top-0 z-[1]",
          isScrolled && "border-b shadow-[0_2px_4px_-1px_rgba(0,0,0,0.15)]",
          isMobileView ? "bg-background" : "bg-muted"
        )}
      >
        <div className="flex items-center gap-1.5 p-2">
          <button
            onClick={() => window.close()}
            className="cursor-pointer group w-3 h-3 rounded-full bg-red-500 hover:opacity-80 flex items-center justify-center"
            aria-label="Close tab"
          >
            <span className="opacity-0 group-hover:opacity-100 text-[10px] font-medium leading-none text-background -translate-y-[0.5px]">×</span>
          </button>
          <button className="group w-3 h-3 rounded-full bg-yellow-500 hover:opacity-80 flex items-center justify-center cursor-default">
            <span className="opacity-0 group-hover:opacity-100 text-[10px] font-medium leading-none text-background -translate-y-[0.5px]">−</span>
          </button>
          <button className="group w-3 h-3 rounded-full bg-green-500 hover:opacity-80 flex items-center justify-center cursor-default">
            <span className="opacity-0 group-hover:opacity-100 text-[10px] font-medium leading-none text-background -translate-y-[0.5px]">+</span>
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            className={cn(
              "p-2 rounded-lg text-muted-foreground/70 hover:text-foreground hover:bg-muted-foreground/10 transition-colors",
              isMobileView && "p-2"
            )}
            onClick={() => setTheme(themeForToggle === "dark" ? "light" : "dark")}
            aria-label="Toggle dark mode"
            title="Toggle dark mode (t)"
          >
            {themeForToggle === "dark" ? (
              <Icons.sun className="h-4 w-4" />
            ) : (
              <Icons.moon className="h-4 w-4" />
            )}
          </button>
          <button
            className={cn(
              "sm:p-2 hover:bg-muted-foreground/10 rounded-lg",
              isMobileView && "p-2"
            )}
            onClick={onNewChat}
            aria-label="New conversation (n)"
          >
            <Icons.new />
          </button>
        </div>
      </div>
    </>
  );
}
