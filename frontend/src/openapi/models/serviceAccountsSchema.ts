/**
 * Generated by Orval
 * Do not edit manually.
 * See `gen:api` script in package.json
 */
import type { ServiceAccountSchema } from './serviceAccountSchema';
import type { RoleSchema } from './roleSchema';

/**
 * Represents a list of service accounts, and includes a list of root roles they reference
 */
export interface ServiceAccountsSchema {
    /** A list of service accounts */
    serviceAccounts: ServiceAccountSchema[];
    /** A list of root roles that are referenced from service account objects in the `serviceAccounts` list */
    rootRoles?: RoleSchema[];
}
