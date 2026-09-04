import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';

/**
 * Hachage des mots de passe.
 *
 * **argon2id**, paramétré comme le § 11 du cahier l'impose : 64 Mo de mémoire,
 * 3 passes, 4 fils. Pas de bcrypt — son coût mémoire est nul, ce qui le rend
 * bien plus facile à attaquer sur GPU.
 *
 * Le **poivre** passe par le paramètre `secret` d'argon2, pas par une
 * concaténation au mot de passe. La différence est réelle : `secret` entre
 * dans la fonction de dérivation elle-même, là où une concaténation ne fait
 * qu'allonger l'entrée — et se heurterait à la borne haute qu'on impose au
 * mot de passe.
 *
 * Ce que le poivre apporte : il ne vit pas en base. Un attaquant qui vole la
 * table `users` n'a pas de quoi tester des hypothèses hors ligne, il lui faut
 * aussi le secret du serveur. C'est toute la différence avec le sel, qui est
 * public et propre à chaque ligne.
 */
@Injectable()
export class PasswordService {
  private readonly pepper: Buffer;

  /** Paramètres de coût. `type` vaut 2 pour argon2id. */
  private static readonly COST = {
    type: argon2.argon2id,
    memoryCost: 65_536, // 64 Mo
    timeCost: 3,
    parallelism: 4,
  } as const;

  constructor(config: ConfigService) {
    this.pepper = Buffer.from(config.getOrThrow<string>('ARGON2_PEPPER'), 'utf8');
  }

  async hash(plain: string): Promise<string> {
    return argon2.hash(plain, { ...PasswordService.COST, secret: this.pepper });
  }

  /**
   * Une comparaison qui échoue à cause d'un hachage illisible renvoie `false`,
   * jamais une exception : un enregistrement corrompu ne doit pas ouvrir de
   * chemin d'erreur différent d'un mauvais mot de passe, sinon la différence
   * de réponse devient un signal exploitable.
   */
  async verify(hash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, plain, { secret: this.pepper });
    } catch {
      return false;
    }
  }

  /**
   * Le hachage doit-il être refait ? Les paramètres d'argon2 évoluent avec le
   * matériel ; on rehache en silence à la prochaine connexion réussie plutôt
   * que d'imposer un changement de mot de passe.
   */
  needsRehash(hash: string): boolean {
    try {
      return argon2.needsRehash(hash, {
        memoryCost: PasswordService.COST.memoryCost,
        timeCost: PasswordService.COST.timeCost,
        parallelism: PasswordService.COST.parallelism,
      });
    } catch {
      return true;
    }
  }

  /**
   * Vérification à vide, pour égaliser le temps de réponse quand le compte
   * demandé n'existe pas.
   *
   * Sans elle, la connexion répond instantanément sur un identifiant inconnu
   * là où elle prend ~50 ms sur un compte réel : l'écart suffit à énumérer la
   * base de clients depuis l'extérieur.
   *
   * Le hachage de référence est calculé **une fois, avec les vrais
   * paramètres** — un condensat bricolé à la main serait rejeté par argon2
   * avant tout calcul, et ne coûterait donc rien du tout.
   */
  async burnTime(plain: string): Promise<void> {
    this.dummyHash ??= await this.hash('mot-de-passe-sans-utilisateur');
    await this.verify(this.dummyHash, plain);
  }

  private dummyHash: string | undefined;
}
