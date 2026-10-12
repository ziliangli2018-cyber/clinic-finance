export interface BankingProfilePurgeArgs {
  profile_id: string;
  actor_user_id: string;
  remove_profile: true;
}

/**
 * Revoke the provider user before removing the local profile. The provider
 * adapter treats a 404 as an already-completed revocation, so a retry can still
 * finish the mandatory local data purge. Other provider failures stop here.
 */
export async function disconnectBankingProfile(
  providerUserId: string,
  profileId: string,
  actorUserId: string,
  disconnectProvider: (providerUserId: string) => Promise<void>,
  purgeLocalProfile: (
    args: BankingProfilePurgeArgs,
  ) => PromiseLike<{ error: unknown }> | Promise<{ error: unknown }>,
): Promise<void> {
  await disconnectProvider(providerUserId);
  const { error } = await purgeLocalProfile({
    profile_id: profileId,
    actor_user_id: actorUserId,
    remove_profile: true,
  });
  if (error) throw new Error('Banking cleanup failed');
}
