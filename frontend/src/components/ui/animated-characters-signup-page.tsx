import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Eye, EyeOff, Mail, User, Users } from "lucide-react";
import { TaskFlowLogo } from "@/components/brand/TaskFlowLogo";
import { AuthAnimatedCharactersPanel } from "@/components/auth/AuthAnimatedCharactersPanel";
import type { Role } from "@/types";

export interface AnimatedCharactersSignupPageProps {
  onRegister: (name: string, email: string, password: string, role: Role) => Promise<boolean>;
}

export function AnimatedCharactersSignupPage({ onRegister }: AnimatedCharactersSignupPageProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [agreedTerms, setAgreedTerms] = useState(false);
  const [role, setRole] = useState<Role>("employee");

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (!agreedTerms) {
      setError("Please accept the Terms of Service and Privacy Policy.");
      return;
    }
    setIsLoading(true);
    try {
      const ok = await onRegister(name.trim(), email.trim(), password, role);
      if (!ok) setError("Could not create account. Please try again.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2">
      <AuthAnimatedCharactersPanel
        password={password}
        showPassword={showPassword}
        isTyping={isTyping}
        header={<TaskFlowLogo variant="onPrimary" />}
      />

      <div className="flex items-center justify-center p-8 bg-background">
        <div className="w-full max-w-[420px]">
          <div className="lg:hidden flex items-center justify-center mb-12">
            <TaskFlowLogo />
          </div>

          <div className="text-center mb-10">
            <h1 className="text-3xl font-bold tracking-tight mb-2">Create your account</h1>
            <p className="text-muted-foreground text-sm">Join your team on TaskFlow</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="signup-name" className="text-sm font-medium">
                Full name
              </Label>
              <Input
                id="signup-name"
                type="text"
                placeholder="Jordan Lee"
                value={name}
                autoComplete="name"
                onChange={(e) => setName(e.target.value)}
                onFocus={() => setIsTyping(true)}
                onBlur={() => setIsTyping(false)}
                required
                className="h-12 bg-background border-border/60 focus:border-primary"
              />
            </div>

            <div className="space-y-3">
              <Label className="text-sm font-medium">I am signing up as</Label>
              <RadioGroup
                value={role}
                onValueChange={(v) => setRole(v as Role)}
                className="grid grid-cols-1 sm:grid-cols-2 gap-3"
              >
                <label
                  htmlFor="role-employee"
                  className={`flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors ${
                    role === "employee"
                      ? "border-primary bg-primary/5 ring-1 ring-primary/20"
                      : "border-border/60 hover:bg-muted/40"
                  }`}
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
                  }`}
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

            <div className="space-y-2">
              <Label htmlFor="signup-email" className="text-sm font-medium">
                Email
              </Label>
              <Input
                id="signup-email"
                type="email"
                placeholder="you@company.com"
                value={email}
                autoComplete="email"
                onChange={(e) => setEmail(e.target.value)}
                onFocus={() => setIsTyping(true)}
                onBlur={() => setIsTyping(false)}
                required
                className="h-12 bg-background border-border/60 focus:border-primary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-password" className="text-sm font-medium">
                Password
              </Label>
              <div className="relative">
                <Input
                  id="signup-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                  className="h-12 pr-10 bg-background border-border/60 focus:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="signup-confirm" className="text-sm font-medium">
                Confirm password
              </Label>
              <Input
                id="signup-confirm"
                type={showPassword ? "text" : "password"}
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                className="h-12 bg-background border-border/60 focus:border-primary"
              />
            </div>

            <div className="flex items-start space-x-2">
              <Checkbox
                id="terms"
                checked={agreedTerms}
                onCheckedChange={(v) => setAgreedTerms(v === true)}
                className="mt-0.5"
              />
              <Label htmlFor="terms" className="text-sm font-normal cursor-pointer leading-snug">
                I agree to the{" "}
                <a href="#" className="text-primary hover:underline">
                  Terms of Service
                </a>{" "}
                and{" "}
                <a href="#" className="text-primary hover:underline">
                  Privacy Policy
                </a>
              </Label>
            </div>

            {error && (
              <div className="p-3 text-sm text-red-400 bg-red-950/20 border border-red-900/30 rounded-lg">{error}</div>
            )}

            <Button type="submit" className="w-full h-12 text-base font-medium" size="lg" disabled={isLoading}>
              {isLoading ? "Creating account..." : "Create account"}
            </Button>
          </form>

          <div className="mt-6">
            <Button
              variant="outline"
              className="w-full h-12 bg-background border-border/60 hover:bg-accent"
              type="button"
            >
              <Mail className="mr-2 size-5" />
              Sign up with Google
            </Button>
          </div>

          <div className="text-center text-sm text-muted-foreground mt-8">
            Already have an account?{" "}
            <Link to="/login" className="text-foreground font-medium hover:underline">
              Log in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
