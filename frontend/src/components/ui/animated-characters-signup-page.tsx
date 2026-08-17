import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ShieldCheck } from "lucide-react";
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

export interface AnimatedCharactersSignupPageProps {
  microsoftEnabled: boolean;
  onMicrosoftSignup: (jobTitle: string, experienceMonths: number) => Promise<void>;
}

export function AnimatedCharactersSignupPage({
  microsoftEnabled,
  onMicrosoftSignup,
}: AnimatedCharactersSignupPageProps) {
  const [msLoading, setMsLoading] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [expYears, setExpYears] = useState(0);
  const [expMonths, setExpMonths] = useState(0);

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
            <h1 className="text-3xl font-bold tracking-tight mb-2">Create your account</h1>
            <p className="text-muted-foreground text-sm">Tell us about yourself, then continue with Microsoft</p>
          </div>

          {!microsoftEnabled && (
            <div className="mb-6 p-3 text-sm text-amber-200 bg-amber-950/30 border border-amber-900/40 rounded-lg">
              Microsoft sign-up is not configured. Set <code className="text-xs">VITE_MICROSOFT_CLIENT_ID</code> in{" "}
              <code className="text-xs">frontend/.env</code>.
            </div>
          )}

          <div className="space-y-6">
            {/* Job title */}
            <div className="space-y-2">
              <Label htmlFor="job-title" className="text-sm font-medium">Job title</Label>
              <Input
                id="job-title"
                placeholder="e.g. Frontend Developer"
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                disabled={!microsoftEnabled || msLoading}
                maxLength={200}
              />
            </div>

            {/* Experience */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">Years of experience</Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Input
                    type="number"
                    min={0}
                    max={60}
                    placeholder="Years"
                    value={expYears || ""}
                    onChange={(e) => setExpYears(Math.max(0, parseInt(e.target.value) || 0))}
                    disabled={!microsoftEnabled || msLoading}
                  />
                  <p className="text-xs text-muted-foreground">Years</p>
                </div>
                <div className="space-y-1">
                  <Input
                    type="number"
                    min={0}
                    max={11}
                    placeholder="Months"
                    value={expMonths || ""}
                    onChange={(e) => setExpMonths(Math.min(11, Math.max(0, parseInt(e.target.value) || 0)))}
                    disabled={!microsoftEnabled || msLoading}
                  />
                  <p className="text-xs text-muted-foreground">Months</p>
                </div>
              </div>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
              <ShieldCheck className="mt-0.5 size-4 shrink-0 text-amber-500" />
              <div className="space-y-1">
                <p className="text-sm font-semibold">A superadmin approves new accounts</p>
                <p className="text-xs text-muted-foreground leading-snug">
                  You will be set up as an employee. Once your account is approved you can sign in,
                  and a superadmin decides from there what access you get.
                </p>
              </div>
            </div>

            <Button
              className="w-full h-12 text-base font-medium gap-2"
              size="lg"
              type="button"
              disabled={!microsoftEnabled || msLoading}
              onClick={async () => {
                setMsLoading(true);
                try {
                  await onMicrosoftSignup(jobTitle.trim(), expYears * 12 + expMonths);
                } finally {
                  setMsLoading(false);
                }
              }}
            >
              <MicrosoftIcon className="size-5 shrink-0" />
              {msLoading ? "Opening Microsoft…" : "Sign up with Microsoft"}
            </Button>
          </div>

          <div className="text-center text-sm text-muted-foreground mt-8">
            Already have an account?{" "}
            <Link to="/login" className="text-foreground font-medium hover:underline">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
