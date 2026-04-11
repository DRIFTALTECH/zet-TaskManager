import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { ZetLogo } from "@/components/brand/ZetLogo";
import { AuthAnimatedCharactersPanel } from "@/components/auth/AuthAnimatedCharactersPanel";

function MicrosoftIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 23 23" aria-hidden>
      <path fill="#f25022" d="M1 1h10v10H1z" />
      <path fill="#00a4ef" d="M1 12h10v10H1z" />
      <path fill="#7fba00" d="M12 1h10v10H12z" />
      <path fill="#ffb900" d="M12 12h10v10H12z" />
    </svg>
  );
}

export interface AnimatedCharactersLoginPageProps {
  /** When false, Microsoft sign-in is unavailable (misconfiguration). */
  microsoftEnabled: boolean;
  onMicrosoftLogin: (rememberMe: boolean) => Promise<void>;
}

export function AnimatedCharactersLoginPage({
  microsoftEnabled,
  onMicrosoftLogin,
}: AnimatedCharactersLoginPageProps) {
  const [rememberMe, setRememberMe] = useState(false);
  const [msLoading, setMsLoading] = useState(false);

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <AuthAnimatedCharactersPanel
        password=""
        showPassword={false}
        isTyping={false}
        header={<ZetLogo variant="onPrimary" />}
      />

      <div className="flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-[420px]">
          <div className="lg:hidden flex items-center justify-center mb-12">
            <ZetLogo />
          </div>

          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold tracking-tight mb-2">Welcome back</h1>
            <p className="text-muted-foreground text-sm">Sign in with your Microsoft work or school account</p>
          </div>

          {!microsoftEnabled && (
            <div className="mb-6 p-3 text-sm text-amber-200 bg-amber-950/30 border border-amber-900/40 rounded-lg">
              Microsoft sign-in is not configured. Set <code className="text-xs">VITE_MICROSOFT_CLIENT_ID</code> in{" "}
              <code className="text-xs">frontend/.env</code>.
            </div>
          )}

          <div className="space-y-5">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="remember"
                checked={rememberMe}
                onCheckedChange={(v) => setRememberMe(v === true)}
                disabled={!microsoftEnabled || msLoading}
              />
              <Label htmlFor="remember" className="text-sm font-normal cursor-pointer">
                Remember for 30 days
              </Label>
            </div>

            <Button
              className="w-full h-12 text-base font-medium gap-2"
              size="lg"
              type="button"
              disabled={!microsoftEnabled || msLoading}
              onClick={async () => {
                setMsLoading(true);
                try {
                  await onMicrosoftLogin(rememberMe);
                } finally {
                  setMsLoading(false);
                }
              }}
            >
              <MicrosoftIcon className="size-5 shrink-0" />
              {msLoading ? "Opening Microsoft…" : "Sign in with Microsoft"}
            </Button>
          </div>

          <div className="text-center text-sm text-muted-foreground mt-8">
            Don&apos;t have an account?{" "}
            <Link to="/signup" className="text-foreground font-medium hover:underline">
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

export const Component = AnimatedCharactersLoginPage;
