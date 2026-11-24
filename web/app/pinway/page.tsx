import { redirect } from "next/navigation";

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

/** Legacy `/pinway` → `/googlemaps2mappls` (query preserved). */
export default async function PinwayRedirectPage({ searchParams }: Props) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue;
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else qs.set(key, value);
  }
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  redirect(`/googlemaps2mappls${suffix}`);
}
