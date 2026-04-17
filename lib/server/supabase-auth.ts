import { createClient, type User } from '@supabase/supabase-js';

function getRequiredEnv(name: 'NEXT_PUBLIC_SUPABASE_URL' | 'NEXT_PUBLIC_SUPABASE_ANON_KEY' | 'SUPABASE_SERVICE_ROLE_KEY') {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} eksik`);
  }
  return value;
}

export function createSupabaseAnonClient() {
  return createClient(getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'), getRequiredEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY'));
}

export function createSupabaseServiceClient() {
  return createClient(getRequiredEnv('NEXT_PUBLIC_SUPABASE_URL'), getRequiredEnv('SUPABASE_SERVICE_ROLE_KEY'));
}

export function getBearerToken(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }
  return token;
}

export async function requireAuthenticatedUser(req: Request): Promise<{ user: User; accessToken: string }> {
  const accessToken = getBearerToken(req);
  if (!accessToken) {
    throw new Error('Unauthorized');
  }

  const authClient = createSupabaseAnonClient();
  const { data, error } = await authClient.auth.getUser(accessToken);
  if (error || !data.user) {
    throw new Error('Unauthorized');
  }

  return { user: data.user, accessToken };
}
