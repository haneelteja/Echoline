export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OAuthTokens {
  accessToken: string;
  /** Only present on the initial authorization_code exchange, or when the
   * provider rotates it on refresh (Google does not; Microsoft does). */
  refreshToken?: string;
  expiresIn: number;
  scope: string;
}
