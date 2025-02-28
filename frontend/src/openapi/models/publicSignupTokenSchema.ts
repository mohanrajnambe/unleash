/**
 * Generated by Orval
 * Do not edit manually.
 * See `gen:api` script in package.json
 */
import type { UserSchema } from './userSchema';
import type { RoleSchema } from './roleSchema';

/**
 * Used for transporting a [public invite link](https://docs.getunleash.io/reference/public-signup#public-sign-up-tokens)
 */
export interface PublicSignupTokenSchema {
    /** The actual value of the token. This is the part that is used by Unleash to create an invite link */
    secret: string;
    /** The public signup link for the token. Users who follow this link will be taken to a signup page where they can create an Unleash user. */
    url: string | null;
    /** The token's name. Only for displaying in the UI */
    name: string;
    /** Whether the token is active. This property will always be `false` for a token that has expired. */
    enabled: boolean;
    /** The time when the token will expire. */
    expiresAt: string;
    /** When the token was created. */
    createdAt: string;
    /** The creator's email or username */
    createdBy: string | null;
    /** Array of users that have signed up using the token. */
    users?: UserSchema[] | null;
    /** Users who sign up using this token will be given this role. */
    role: RoleSchema;
}
