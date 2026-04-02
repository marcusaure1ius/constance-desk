import { Skeleton } from "@/components/ui/skeleton";

function SkeletonCard() {
  return (
    <div className="rounded-lg border bg-card p-3 shadow-sm">
      <Skeleton className="h-4 w-3/4" />
      <div className="mt-2 flex items-center gap-1.5">
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
    </div>
  );
}

function SkeletonColumn() {
  return (
    <div className="flex w-72 flex-shrink-0 flex-col rounded-lg bg-muted/50 p-2">
      <div className="mb-2 flex items-center justify-between px-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-3 w-4" />
      </div>
      <div className="flex flex-1 flex-col gap-2 p-1">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
    </div>
  );
}

export default function Loading() {
  return (
    <div className="flex-1 overflow-hidden">
      <div className="flex items-center justify-between p-4 pb-0 container mx-auto">
        <Skeleton className="h-9 w-40" />
      </div>
      <div className="hidden md:flex gap-4 overflow-x-auto p-4 h-full container mx-auto">
        <SkeletonColumn />
        <SkeletonColumn />
        <SkeletonColumn />
        <SkeletonColumn />
      </div>
      {/* Mobile skeleton */}
      <div className="md:hidden flex flex-col">
        <div className="flex border-b p-2 gap-4">
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-20" />
          <Skeleton className="h-6 w-20" />
        </div>
        <div className="p-4 space-y-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      </div>
    </div>
  );
}
