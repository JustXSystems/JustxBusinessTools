import { redirect } from "next/navigation";

export default function AdminSkusRedirectPage() {
  redirect("/admin/tools?tab=pricing");
}
