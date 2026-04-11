import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { User, Users } from "lucide-react";
import { ZetLogo } from "@/components/brand/ZetLogo";
import { AuthAnimatedCharactersPanel } from "@/components/auth/AuthAnimatedCharactersPanel";
import type { Role } from "@/types";

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
  onMicrosoftSignup: (role: Role) => Promise<void>;
}

export function AnimatedCharactersSignupPage({
  microsoftEnabled,
  onMicrosoftSignup,
}: AnimatedCharactersSignupPageProps) {
  const [msLoading, setMsLoading] = useState(false);
  const [role, setRole] = useState<Role>("employee");

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
            <p className="text-muted-foreground text-sm">Choose your role, then continue with Microsoft</p>
          </div>

          {!microsoftEnabled && (
            <div className="mb-6 p-3 text-sm text-amber-200 bg-amber-950/30 border border-amber-900/40 rounded-lg">
              Microsoft sign-up is not configured. Set <code className="text-xs">VITE_MICROSOFT_CLIENT_ID</code> in{" "}
              <code className="text-xs">frontend/.env</code>.
            </div>
          )}

          <div className="space-y-6">
            <div className="space-y-3">
              <Label className="text-sm font-medium">Are you an employee or a manager?</Label>
              <RadioGroup
                value={role}
                onValueChange={(v) => setRole(v as Role)}
                className="grid grid-cols-1 sm:grid-cols-2 gap-3"
                disabled={!microsoftEnabled || msLoading}
              >
                <label
                  htmlFor="role-employee"
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                    role === "employee"
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border/60 hover:bg-muted/40"
                  } ${!microsoftEnabled || msLoading ? "opacity-60 pointer-events-none" : ""}`}
                >
                  <RadioGroupItem value="employee" id="role-employee" className="mt-0.5" />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <User className="size-4 text-muted-foreground" />
                      Employee
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">
                      Log time, work on assigned tasks, and use your personal timesheet.
                    </p>
                  </div>
                </label>
                <label
                  htmlFor="role-manager"
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                    role === "manager"
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border/60 hover:bg-muted/40"
                  } ${!microsoftEnabled || msLoading ? "opacity-60 pointer-events-none" : ""}`}
                >
                  <RadioGroupItem value="manager" id="role-manager" className="mt-0.5" />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Users className="size-4 text-muted-foreground" />
                      Manager
                    </div>
                    <p className="text-xs text-muted-foreground leading-snug">
                      Create projects, assign work, approve tasks, and manage the team.
                    </p>
                  </div>
                </label>
              </RadioGroup>
            </div>

            <Button
              className="w-full h-12 text-base font-medium gap-2"
              size="lg"
              type="button"
              disabled={!microsoftEnabled || msLoading}
              onClick={async () => {
                setMsLoading(true);
                try {
                  await onMicrosoftSignup(role);
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
