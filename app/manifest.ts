import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "JustXSystems",
    short_name: "JustXSystems",
    description:
      "Quotations, invoices, stock, projects, and calculators for Indian businesses.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0b0f",
    theme_color: "#00dfff",
    categories: ["business", "finance", "productivity"],
    icons: [
      {
        src: "/icons/jbt-icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
    ],
  };
}
