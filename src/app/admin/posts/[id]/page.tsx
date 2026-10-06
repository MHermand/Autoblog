import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PostEditor } from "@/components/editor/post-editor";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("editor") };
}

export default async function EditPostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <PostEditor id={id} />;
}
