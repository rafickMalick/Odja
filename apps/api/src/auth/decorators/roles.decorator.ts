import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '@oja/db';

export const ROLES_KEY = 'oja:roles';

/** Restreint une route à certains profils. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
