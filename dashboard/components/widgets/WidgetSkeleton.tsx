interface WidgetSkeletonProps {
  type: "chart" | "kpi" | "table" | "number";
}

export default function WidgetSkeleton({ type }: WidgetSkeletonProps) {
  if (type === "chart") {
    return (
      <div data-testid="widget-skeleton" className="animate-pulse">
        <div className="h-[200px] bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  if (type === "kpi") {
    return (
      <div data-testid="widget-skeleton" className="animate-pulse flex gap-4">
        <div className="h-[80px] flex-1 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-[80px] flex-1 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-[80px] flex-1 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  if (type === "table") {
    return (
      <div data-testid="widget-skeleton" className="animate-pulse space-y-2">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded" />
      </div>
    );
  }

  return (
    <div data-testid="widget-skeleton" className="animate-pulse">
      <div className="h-10 w-full bg-gray-200 dark:bg-gray-700 rounded" />
    </div>
  );
}
