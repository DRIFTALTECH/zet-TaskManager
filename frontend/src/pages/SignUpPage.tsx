import { Navigate, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useAppStore } from '@/stores/appStore';
import { AnimatedCharactersSignupPage } from '@/components/ui/animated-characters-signup-page';

const SignUpPage = () => {
  const register = useAppStore(s => s.register);
  const currentUser = useAppStore(s => s.currentUser);
  const navigate = useNavigate();

  if (currentUser) return <Navigate to="/" replace />;

  return (
    <AnimatedCharactersSignupPage
      onRegister={async (name, email, password, role) => {
        const user = await register(name, email, password, role);
        if (user) {
          toast.success(`Welcome to TaskFlow, ${user.name}!`);
          navigate('/', { replace: true });
          return true;
        }
        return false;
      }}
    />
  );
};

export default SignUpPage;
