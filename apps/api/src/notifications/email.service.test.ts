import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { EmailService, parseAddress } from './email.service';

/**
 * Envoi d'e-mails par l'API HTTP de Brevo.
 *
 * Render bloque les ports SMTP sur ses services gratuits : en production,
 * c'est ce canal qui part. On vérifie ce qui est envoyé, et qu'un refus de
 * Brevo remonte en erreur au lieu d'être avalé.
 */

function serviceWith(values: Record<string, unknown>): EmailService {
  const config = {
    get: (key: string, fallback?: unknown) => values[key] ?? fallback,
    getOrThrow: (key: string) => values[key],
  } as unknown as ConfigService;
  return new EmailService(config);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Envoi par l’API Brevo', () => {
  it('poste le message avec la clé, l’expéditeur et le destinataire', async () => {
    const fetchMock = vi.fn(async () => new Response('{"messageId":"x"}', { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);

    await serviceWith({
      BREVO_API_KEY: 'xkeysib-test',
      MAIL_FROM: 'Ojà <bonjour@oja.market>',
      SMTP_HOST: 'smtp-relay.brevo.com',
    }).send({ to: 'awa@exemple.com', subject: 'Bienvenue', text: 'Bonjour', html: '<p>Bonjour</p>' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/smtp/email');
    expect((init.headers as Record<string, string>)['api-key']).toBe('xkeysib-test');
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { name: 'Ojà', email: 'bonjour@oja.market' },
      to: [{ email: 'awa@exemple.com' }],
      subject: 'Bienvenue',
      textContent: 'Bonjour',
      htmlContent: '<p>Bonjour</p>',
    });
    // Borné dans le temps : un relais muet ne doit plus bloquer la requête.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('remonte un refus de Brevo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"Key not found"}', { status: 401 })),
    );

    await expect(
      serviceWith({ BREVO_API_KEY: 'mauvaise-cle' }).send({
        to: 'awa@exemple.com',
        subject: 'Test',
        text: 'Test',
      }),
    ).rejects.toThrow(/HTTP 401/);
  });

  it('échoue bruyamment en production sans aucun canal', async () => {
    await expect(
      serviceWith({ NODE_ENV: 'production' }).send({ to: 'a@b.c', subject: 's', text: 't' }),
    ).rejects.toThrow(/non configuré/);
  });
});

describe('Adresse d’expédition', () => {
  it('sépare le nom et l’adresse', () => {
    expect(parseAddress('Ojà <bonjour@oja.market>')).toEqual({
      name: 'Ojà',
      email: 'bonjour@oja.market',
    });
    expect(parseAddress('"Ojà Support" <support@oja.market>')).toEqual({
      name: 'Ojà Support',
      email: 'support@oja.market',
    });
    expect(parseAddress('bonjour@oja.market')).toEqual({ email: 'bonjour@oja.market' });
  });
});
