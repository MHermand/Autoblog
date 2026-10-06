import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PostsPage } from "@/components/posts/posts-page";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("metadata");
  return { title: t("posts") };
}

export default function AdminPostsPage() {
  return <PostsPage />;
}
