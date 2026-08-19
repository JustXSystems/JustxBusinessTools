import { ToolView } from "@/components/tools/ToolView";
import { notFound } from "next/navigation";

type Props = { params: Promise<{ toolId: string }> };

export default async function ToolPage({ params }: Props) {
  const { toolId } = await params;

  if (toolId === "notifications") {
    notFound();
  }

  return <ToolView toolId={toolId} />;
}
