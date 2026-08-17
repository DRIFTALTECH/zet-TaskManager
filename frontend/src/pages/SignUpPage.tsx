import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { AnimatedCharactersSignupPage } from '@/components/ui/animated-characters-signup-page';
import {
  formatMsalAuthError,
  isMicrosoftAuthConfigured,
  signUpWithMicrosoftRedirect,
} from '@/lib/microsoftAuth';

const SignUpPage = () => {
  const currentUser = useAppStore(s => s.currentUser);

  if (currentUser) return <Navigate to="/" replace />;

  return (
    <AnimatedCharactersSignupPage
      microsoftEnabled={isMicrosoftAuthConfigured()}
      onMicrosoftSignup={async (jobTitle: string, experienceMonths: number) => {
        try {
          await signUpWithMicrosoftRedirect(jobTitle, experienceMonths);
        } catch (e) {
          const msg = formatMsalAuthError(e);
          toast.error(msg || 'Microsoft sign-up failed.');
        }
      }}
    />
  );
};

export default SignUpPage;
