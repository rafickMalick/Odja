import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../prisma/prisma.service';
import { NewsletterService } from './newsletter.service';

/**
 * Copie des abonnés vers la liste Brevo.
 *
 * Ce qui compte : la bonne liste reçoit l'adresse, un refus de Brevo ne casse
 * jamais l'inscription, et sans configuration rien ne part.
 */

function serviceWith(values: Record<string, unknown>) {
  const config = {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
  } as unknown as ConfigService;
  const update = vi.fn(async () => ({}));
  const prisma = { newsletterSubscriber: { update } } as unknown as PrismaService;
  return { service: new NewsletterService(prisma, config), update };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Copie vers Brevo', () => {
  it('ajoute l’adresse à la liste configurée et note la copie', async () => {
    const fetchMock = vi.fn(async () => new Response('{"id":42}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const { service, update } = serviceWith({
      BREVO_API_KEY: 'xkeysib-test',
      BREVO_NEWSLETTER_LIST_ID: 7,
    });

    await expect(service.syncToBrevo('awa@exemple.com')).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/contacts');
    expect((init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test');
    expect(JSON.parse(init.body as string)).toEqual({
      email: 'awa@exemple.com',
      listIds: [7],
      updateEnabled: true,
    });
    expect(update).toHaveBeenCalledWith({
      where: { email: 'awa@exemple.com' },
      data: { brevoSyncedAt: expect.any(Date) },
    });
  });

  it('avale un refus de Brevo sans marquer la copie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"Key not found"}', { status: 401 })),
    );
    const { service, update } = serviceWith({
      BREVO_API_KEY: 'mauvaise-cle',
      BREVO_NEWSLETTER_LIST_ID: 7,
    });

    await expect(service.syncToBrevo('awa@exemple.com')).resolves.toBe(false);
    expect(update).not.toHaveBeenCalled();
  });

  it('ne contacte pas Brevo sans liste configurée', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const { service } = serviceWith({ BREVO_API_KEY: 'xkeysib-test' });

    await expect(service.syncToBrevo('awa@exemple.com')).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
