import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { auth } from "@/auth";
import { CameraCoach } from "@/components/camera/CameraCoach";

export async function generateMetadata() {
  const t = await getTranslations("camera");
  return { title: t("title") };
}

export default async function CameraPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/");
  return <CameraCoach />;
}
