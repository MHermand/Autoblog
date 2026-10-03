"use client";

import { useTranslations } from "next-intl";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { deletePost } from "@/lib/api";
import { queryKeys } from "@/lib/queries";
import { useErrorMessage } from "@/lib/use-error-message";

interface DeletePostDialogProps {
  /** The post to delete; the dialog is open while this is set. */
  post: { id: string; title: string } | null;
  onClose: () => void;
  onDeleted?: () => void;
}

export function DeletePostDialog({ post, onClose, onDeleted }: DeletePostDialogProps) {
  const t = useTranslations("posts.delete");
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();

  const remove = useMutation({
    mutationFn: (id: string) => deletePost(id),
    onSuccess: async () => {
      toast.success(t("done"));
      await queryClient.invalidateQueries({ queryKey: queryKeys.posts });
      onDeleted?.();
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <AlertDialog open={post !== null} onOpenChange={(open) => !open && !remove.isPending && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("description", { title: post?.title ?? "" })}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={remove.isPending}>{t("cancel")}</AlertDialogCancel>
          {/* A plain Button, not AlertDialogAction: the dialog must stay open until the request ends. */}
          <Button variant="destructive" disabled={remove.isPending} onClick={() => post && remove.mutate(post.id)}>
            {remove.isPending ? t("deleting") : t("confirm")}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
