import { RunDetail } from "@/components/etl/RunDetail";

interface PageProps {
  params: { id: string };
}

export default function EtlRunDetailPage({ params }: PageProps) {
  return <RunDetail runId={params.id} />;
}
