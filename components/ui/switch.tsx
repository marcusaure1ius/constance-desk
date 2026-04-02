"use client"

import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/lib/utils"

function Switch({
  className,
  size = "default",
  ...props
}: SwitchPrimitive.Root.Props & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch relative inline-flex shrink-0 items-center rounded-full transition-all outline-none after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 data-checked:bg-primary data-unchecked:bg-input dark:data-unchecked:bg-input/80 data-disabled:cursor-not-allowed data-disabled:opacity-50",
        "data-[size=default]:h-[28px] data-[size=default]:w-[48px] data-[size=default]:p-[3px]",
        "data-[size=sm]:h-[22px] data-[size=sm]:w-[38px] data-[size=sm]:p-[2px]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-background shadow-sm ring-0 transition-transform",
          "dark:data-checked:bg-primary-foreground dark:data-unchecked:bg-foreground",
          "group-data-[size=default]/switch:size-[22px] group-data-[size=default]/switch:data-checked:translate-x-5 group-data-[size=default]/switch:data-unchecked:translate-x-0",
          "group-data-[size=sm]/switch:size-[18px] group-data-[size=sm]/switch:data-checked:translate-x-4 group-data-[size=sm]/switch:data-unchecked:translate-x-0"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
