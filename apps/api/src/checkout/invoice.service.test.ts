import { LEGAL } from '@oja/contracts';
import { describe, expect, it } from 'vitest';

import { sellerMentions } from './invoice.service';

/**
 * Une facture ne porte que des mentions réelles : tant que la société n'est
 * pas immatriculée (`LEGAL` vide), rien d'inventé n'y figure.
 */
describe('Mentions du vendeur sur la facture', () => {
  it('n’imprime que ce qui est renseigné dans LEGAL', () => {
    const mentions = sellerMentions();
    const expected = [
      LEGAL.legalForm,
      LEGAL.address,
      LEGAL.rccm ? `RCCM : ${LEGAL.rccm}` : null,
      LEGAL.ifu ? `IFU : ${LEGAL.ifu}` : null,
      `Contact : ${LEGAL.supportEmail}`,
    ].filter(Boolean);
    expect(mentions).toEqual(expected);
    expect(mentions.join(' ')).not.toMatch(/null|undefined|à compléter/i);
  });
});
