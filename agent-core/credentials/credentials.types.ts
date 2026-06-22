/**
 * The credential seam — a lookup table that resolves an opaque placeholder name
 * to a real secret value at tool-execution time.
 *
 * @remarks
 * Sibling to `../permissions`: the SDK owns the *contract* (how placeholders are
 * substituted and scrubbed, see {@link withCredentials}), the consumer owns
 * *where the secrets come from*.
 *
 * The model and the conversation transcript only ever see placeholders like
 * `{{github_token}}`. The real value exists for the duration of one `execute`
 * call and is scrubbed back out of the result. Back it with the shipped in-memory
 * battery ({@link InMemoryCredentialStore}) or bring your own — a JSON file, an OS
 * keychain, or a remote vault; the decorator only depends on
 * {@link CredentialStore.resolve}.
 *
 * SECURITY: a {@link CredentialStore} holds plaintext secrets in memory. It is
 * the trust boundary — only wire it to tools you intend to hand real
 * credentials.
 *
 * @module
 */

/**
 * A lookup table resolving a placeholder name to its secret value.
 *
 * @remarks
 * SECURITY: implementations hold plaintext secrets. This interface is the trust
 * boundary between opaque placeholders (what the model sees) and real secret
 * values (what tools receive). See {@link withCredentials} for the wrapper that
 * consumes it.
 *
 * @see {@link InMemoryCredentialStore} for the v1 RAM-backed implementation.
 * @see {@link withCredentials} for the decorator that depends on this interface.
 * @group Credentials
 */
export interface CredentialStore {
  /**
   * Resolve a placeholder name (the `x` in `{{x}}`) to its secret value.
   *
   * @remarks
   * Async so a real vault can fetch over the network.
   *
   * @param name - The placeholder name to resolve.
   * @returns The secret value, or `undefined` if no such credential exists.
   */
  resolve(name: string): Promise<string | undefined>;
}
