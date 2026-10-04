import { describe, expect, it, vi } from 'vitest';

import { ShipmentService } from './shipment.service';

/**
 * Envoi du code de réception.
 *
 * En production, aucun agrégateur SMS n'est branché : l'envoi lève une erreur.
 * Elle faisait échouer « prête » côté atelier et empêchait de prévenir les
 * livreurs. Le code doit partir par e-mail quand même, sans rien bloquer.
 */
function serviceWith(sms: { send: () => Promise<void> }, email: { send: () => Promise<void> }) {
  const prisma = {
    user: {
      findUnique: vi.fn().mockResolvedValue({ email: 'awa@exemple.bj', firstName: 'Awa' }),
    },
  };
  const config = { get: (_key: string, fallback: unknown) => fallback };
  return new ShipmentService(
    prisma as never,
    sms as never,
    {} as never,
    {} as never,
    {} as never,
    email as never,
    config as never,
  );
}

const ORDER = { reference: 'CMD-2026-000001', shipPhone: '+22990000000', customerId: 'u1' };

describe('code de réception', () => {
  it('part par e-mail même si le SMS échoue, sans lever d’erreur', async () => {
    const email = { send: vi.fn().mockResolvedValue(undefined) };
    const service = serviceWith(
      { send: vi.fn().mockRejectedValue(new Error('Envoi de SMS non configuré')) },
      email,
    );

    await expect(
      (service as unknown as { sendReceptionCode: (o: typeof ORDER, otp: string) => Promise<void> })
        .sendReceptionCode(ORDER, '4821'),
    ).resolves.toBeUndefined();

    expect(email.send).toHaveBeenCalledOnce();
    expect(email.send.mock.calls[0]?.[0]).toMatchObject({ to: 'awa@exemple.bj' });
    expect((email.send.mock.calls[0]?.[0] as { text: string }).text).toContain('4821');
  });

  it('ne lève pas non plus si l’e-mail échoue', async () => {
    const service = serviceWith(
      { send: vi.fn().mockRejectedValue(new Error('pas de SMS')) },
      { send: vi.fn().mockRejectedValue(new Error('Brevo indisponible')) },
    );

    await expect(
      (service as unknown as { sendReceptionCode: (o: typeof ORDER, otp: string) => Promise<void> })
        .sendReceptionCode(ORDER, '4821'),
    ).resolves.toBeUndefined();
  });
});
