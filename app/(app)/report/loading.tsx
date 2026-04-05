import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Skeleton className="h-8 w-64" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>

      {/* Grid: 3/4 + 1/4 */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_1fr] gap-6">
        {/* Left column */}
        <div className="space-y-6">
          {/* Chart card */}
          <div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4 space-y-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-64 w-full" />
          </div>

          {/* Tables */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4 space-y-3">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
            <div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4 space-y-3">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4 space-y-3">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-2 w-full rounded-full" />
          <div className="space-y-2 pt-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    </div>
  );
}
