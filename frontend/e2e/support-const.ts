import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const API = 'http://127.0.0.1:8001';
export const ADMIN = { email: 'e2e-admin@example.com', password: 'T3st!passphrase' };
export const TOKEN_FILE = join(tmpdir(), 'zet-e2e-token');
