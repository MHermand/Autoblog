"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Loader2, MailCheck } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/field";
import { Input } from "@/components/ui/input";
import { requestMagicLink } from "@/lib/api";
import { useErrorMessage } from "@/lib/use-error-message";

type LoginErrorKey = "invalidLink" | "expiredLink" | "notAllowed" | "misconfigured";

// Error codes the sign-in callback may put in `/login?error=`, grouped by message.
const CALLBACK_ERRORS: Record<string, LoginErrorKey> = {
  invalid_link: "invalidLink",
  invalid_code: "invalidLink",
  missing_code: "invalidLink",
  auth_failed: "invalidLink",
  expired_link: "expiredLink",
  otp_expired: "expiredLink",
  not_allowed: "notAllowed",
  forbidden: "notAllowed",
  unauthorized: "notAllowed",
  not_authorized: "notAllowed",
  access_denied: "notAllowed",
  server_misconfigured: "misconfigured",
};

export function LoginForm({ initialError }: { initialError: string | null }) {
  const t = useTranslations("login");
  const errorMessage = useErrorMessage();

  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    if (!initialError) return null;
    const key = CALLBACK_ERRORS[initialError];
    return key ? t(`errors.${key}`) : t("errors.generic", { code: initialError });
  });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const address = email.trim();
    if (!address || sending) return;
    setSending(true);
    setError(null);
    try {
      await requestMagicLink(address);
      setSentTo(address);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  if (sentTo) {
    return (
      <Card>
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-muted">
            <MailCheck className="size-5" aria-hidden="true" />
          </div>
          <CardTitle className="text-lg" role="status">
            {t("sentTitle")}
          </CardTitle>
          <CardDescription>{t("sentBody", { email: sentTo })}</CardDescription>
        </CardHeader>
        <CardContent className="items-center">
          <p className="text-center text-xs text-muted-foreground">{t("sentHint")}</p>
          <Button
            variant="link"
            onClick={() => {
              setSentTo(null);
              setEmail("");
            }}
          >
            {t("useAnotherEmail")}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t("title")}</CardTitle>
        <CardDescription>{t("description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-4">
          {error ? (
            <Alert variant="destructive">
              <AlertTriangle aria-hidden="true" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Field label={t("emailLabel")}>
            <Input
              type="email"
              name="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t("emailPlaceholder")}
              required
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </Field>
          <Button type="submit" disabled={sending || !email.trim()}>
            {sending ? <Loader2 className="animate-spin" data-icon="inline-start" aria-hidden="true" /> : null}
            {sending ? t("sending") : t("submit")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
