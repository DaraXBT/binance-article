import { cookies } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';

const SESSION_COOKIE_NAME = 'deckforge_session';
const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

/**
 * Get or create an anonymous session ID from cookies.
 * Each visitor gets a unique ID stored in a cookie.
 * No login required — decks are linked to this ID.
 */
export async function getSessionId(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(SESSION_COOKIE_NAME);

  if (existing?.value) {
    return existing.value;
  }

  // Generate new session ID
  const sessionId = uuidv4();

  cookieStore.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });

  return sessionId;
}
