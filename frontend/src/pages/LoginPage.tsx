import { Navigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { AnimatedCharactersLoginPage } from '@/components/ui/animated-characters-login-page';
import {
  formatMsalAuthError,
  isMicrosoftAuthConfigured,
  signInWithMicrosoftRedirect,
} from '@/lib/microsoftAuth';

const LoginPage = () => {
  const currentUser = useAppStore(s => s.currentUser);

  if (currentUser) return <Navigate to="/" replace />;

  return (
    <AnimatedCharactersLoginPage
      microsoftEnabled={isMicrosoftAuthConfigured()}
      onMicrosoftLogin={async rememberMe => {
        try {
          await signInWithMicrosoftRedirect(rememberMe);
        } catch (e) {
          const msg = formatMsalAuthError(e);
          toast.error(msg || 'Microsoft sign-in failed.');
        }
      }}
    />
  );
};

export default LoginPage;
