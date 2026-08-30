import { ImageResponse } from "next/og.js";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import React from "react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "public", "icons", "presets");

async function save(name, element) {
  const res = new ImageResponse(element, { width: 512, height: 512 });
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(path.join(outDir, name), buf);
  console.log("wrote", name, buf.length);
}

const h = React.createElement;
const teal = "#0B2E2F";
const amber = "#F2A93B";
const paper = "#FBF9F4";

await mkdir(outDir, { recursive: true });

await save(
  "justx-mark.png",
  h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0B2E2F 0%, #1B5C5D 100%)",
      },
    },
    h("div", { style: { display: "flex", color: amber, fontSize: 220, fontWeight: 700 } }, "X"),
  ),
);

await save(
  "justx-shield.png",
  h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: paper,
      },
    },
    h(
      "div",
      {
        style: {
          width: 340,
          height: 380,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: teal,
          borderRadius: 40,
          color: amber,
          fontSize: 180,
          fontWeight: 700,
        },
      },
      "X",
    ),
  ),
);

await save(
  "justx-orbit.png",
  h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: teal,
      },
    },
    h(
      "div",
      {
        style: {
          width: 300,
          height: 300,
          border: "14px solid rgba(242,169,59,0.55)",
          borderRadius: 999,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: paper,
          fontSize: 160,
          fontWeight: 700,
        },
      },
      "X",
    ),
  ),
);

await save(
  "justx-tile.png",
  h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "linear-gradient(135deg, #0B2E2F 0%, #1B5C5D 100%)",
        color: paper,
        fontSize: 160,
        fontWeight: 700,
      },
    },
    h("div", { style: { display: "flex" } }, "JX"),
    h("div", {
      style: { width: 160, height: 14, background: amber, borderRadius: 8, marginTop: 12 },
    }),
  ),
);

await save(
  "justx-seal.png",
  h(
    "div",
    {
      style: {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: paper,
      },
    },
    h(
      "div",
      {
        style: {
          width: 380,
          height: 380,
          borderRadius: 999,
          background: teal,
          border: "12px solid #F2A93B",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: paper,
          fontSize: 160,
          fontWeight: 700,
        },
      },
      "X",
    ),
  ),
);

console.log("done");
