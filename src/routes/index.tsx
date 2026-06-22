import { createFileRoute } from "@tanstack/react-router";
import Editor from "@/components/editor/Editor";
import { Toaster } from "@/components/ui/sonner";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Mini-Adobe AI — Smart Image Editor" },
      { name: "description", content: "Browser-based image editing with AI background removal, color tools, filters, morphology, frequency-domain and drawing." },
      { property: "og:title", content: "Mini-Adobe AI — Smart Image Editor" },
      { property: "og:description", content: "Browser-based image editing with AI background removal, color tools, filters, morphology, frequency-domain and drawing." },
    ],
  }),
  component: Index,
});

function Index() {
  return (
    <>
      <Editor />
      <Toaster theme="dark" position="bottom-right" />
    </>
  );
}
