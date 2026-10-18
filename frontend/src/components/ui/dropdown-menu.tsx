import * as React from "react";
import { cn } from "@/lib/utils";

interface DropdownMenuContextValue {
  open: boolean;
  setOpen: React.Dispatch<React.SetStateAction<boolean>>;
  triggerRef: React.RefObject<HTMLButtonElement>;
  contentRef: React.RefObject<HTMLDivElement>;
}

const DropdownMenuContext = React.createContext<DropdownMenuContextValue | null>(null);

export const DropdownMenu: React.FC<{
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}> = ({ children, open: controlledOpen, onOpenChange }) => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : uncontrolledOpen;

  const setOpen = React.useCallback(
    (value: React.SetStateAction<boolean>) => {
      const next = typeof value === "function" ? value(open) : value;
      if (!isControlled) {
        setUncontrolledOpen(next);
      }
      onOpenChange?.(next);
    },
    [isControlled, open, onOpenChange]
  );

  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const contentRef = React.useRef<HTMLDivElement>(null);

  // Close on click outside & Escape key
  React.useEffect(() => {
    if (!open) return;

    const handlePointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node;
      if (
        contentRef.current &&
        !contentRef.current.contains(target) &&
        triggerRef.current &&
        !triggerRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, setOpen]);

  return (
    <DropdownMenuContext.Provider value={{ open, setOpen, triggerRef, contentRef }}>
      <div className="relative inline-block text-left">{children}</div>
    </DropdownMenuContext.Provider>
  );
};

export const DropdownMenuTrigger = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { asChild?: boolean }
>(({ className, children, asChild, onClick, ...props }, ref) => {
  const ctx = React.useContext(DropdownMenuContext);
  if (!ctx) throw new Error("DropdownMenuTrigger must be inside DropdownMenu");

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    ctx.setOpen((prev) => !prev);
    onClick?.(e);
  };

  if (asChild && React.isValidElement(children)) {
    const child = children as React.ReactElement<any>;
    return React.cloneElement(child, {
      ref: (node: any) => {
        // @ts-ignore
        ctx.triggerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node;
        const childRef = (child as any).ref;
        if (typeof childRef === "function") childRef(node);
        else if (childRef) childRef.current = node;
      },
      "aria-haspopup": "menu",
      "aria-expanded": ctx.open,
      onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
        handleClick(e);
        child.props.onClick?.(e);
      },
      ...props,
    });
  }

  return (
    <button
      ref={(node) => {
        // @ts-ignore
        ctx.triggerRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLButtonElement | null>).current = node;
      }}
      type="button"
      aria-haspopup="menu"
      aria-expanded={ctx.open}
      className={className}
      onClick={handleClick}
      {...props}
    >
      {children}
    </button>
  );
});
DropdownMenuTrigger.displayName = "DropdownMenuTrigger";

export const DropdownMenuContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { align?: "start" | "end" | "center"; sideOffset?: number }
>(({ className, align = "start", children, ...props }, ref) => {
  const ctx = React.useContext(DropdownMenuContext);
  if (!ctx) throw new Error("DropdownMenuContent must be inside DropdownMenu");

  if (!ctx.open) return null;

  const alignClass =
    align === "end"
      ? "right-0"
      : align === "center"
      ? "left-1/2 -translate-x-1/2"
      : "left-0";

  return (
    <div
      ref={(node) => {
        // @ts-ignore
        ctx.contentRef.current = node;
        if (typeof ref === "function") ref(node);
        else if (ref) (ref as React.MutableRefObject<HTMLDivElement | null>).current = node;
      }}
      role="menu"
      aria-orientation="vertical"
      className={cn(
        "absolute top-full mt-2 z-50 min-w-[14rem] overflow-hidden rounded-2xl border border-neutral-200/90 bg-white p-1.5 text-neutral-800 shadow-xl animate-in fade-in-0 zoom-in-95 dark:border-neutral-800 dark:bg-[#0d131f] dark:text-neutral-100",
        alignClass,
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
});
DropdownMenuContent.displayName = "DropdownMenuContent";

export const DropdownMenuItem = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { disabled?: boolean }
>(({ className, disabled, onClick, children, ...props }, ref) => {
  const ctx = React.useContext(DropdownMenuContext);

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (disabled) {
      e.preventDefault();
      return;
    }
    onClick?.(e);
    ctx?.setOpen(false);
  };

  return (
    <div
      ref={ref}
      role="menuitem"
      aria-disabled={disabled}
      className={cn(
        "relative flex cursor-pointer select-none items-center rounded-xl px-2.5 py-2 text-xs font-medium outline-none transition-colors hover:bg-neutral-100 dark:hover:bg-neutral-800/80 focus:bg-neutral-100 dark:focus:bg-neutral-800 data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        disabled && "opacity-40 cursor-not-allowed hover:bg-transparent dark:hover:bg-transparent",
        className
      )}
      onClick={handleClick}
      {...props}
    >
      {children}
    </div>
  );
});
DropdownMenuItem.displayName = "DropdownMenuItem";

export const DropdownMenuLabel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "px-2.5 py-1.5 text-[10px] font-mono uppercase tracking-wider text-neutral-400 dark:text-neutral-500",
      className
    )}
    {...props}
  />
));
DropdownMenuLabel.displayName = "DropdownMenuLabel";

export const DropdownMenuSeparator = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("-mx-1 my-1 h-[1px] bg-neutral-100 dark:bg-neutral-800", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = "DropdownMenuSeparator";

export const DropdownMenuGroup: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div role="group">{children}</div>
);
