import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { AnimatedCharactersLoginPage } from '@/components/ui/animated-characters-login-page';

const LoginPage = () => {
  const login = useAppStore(s => s.login);
  const currentUser = useAppStore(s => s.currentUser);
  const navigate = useNavigate();

  if (currentUser) return <Navigate to="/" replace />;

  return (
    <AnimatedCharactersLoginPage
      onLogin={async (email, password, rememberMe) => {
        const user = await login(email, password, rememberMe);
        if (user) {
          toast.success(`Welcome back, ${user.name}!`);
          navigate('/', { replace: true });
          return true;
        }
        return false;
      }}
    />
  );
};

export default LoginPage;
